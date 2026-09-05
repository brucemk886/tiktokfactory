import crypto from "node:crypto";
import {
  accountKeyFromConnectionId,
  beijingDateKey,
  closeOfficialHistoryDatabase,
  ensureStoreIdentity,
  getSourceStoreId,
  hasVideoSnapshotForDate,
  loadAccountSnapshots,
  loadLatestAccount,
  loadLatestVideo,
  loadVideoSnapshots,
  officialHistoryDatabasePath,
  openOfficialHistoryDatabase,
  resetSourceStoreIdentity,
  stableStringify,
  stripNestedSnapshotLists,
  upsertAccountSnapshot,
  upsertVideoSnapshot,
  withImmediateTransaction,
} from "./official-history-db.js";
import {
  compactOfficialPublishRecord,
  mergeOfficialRecordFields,
  normalizeOfficialPublishRecord,
  officialRecordKey,
  officialRecordTime,
} from "./official-publish-records.js";
import { isOfficialTikTokPublishRecord } from "./publish-record-sources.js";

const DEFAULT_PAGE_LIMIT = 200;
const DEFAULT_OUTBOX_BYTES = 512 * 1024;
const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_TRACKING_DAYS = 400;
const DAY_MS = 86_400_000;
const TERMINAL_FAILURES = new Set(["failed", "rejected", "status_timeout", "needs_review", "canceled", "cancelled"]);
const SNAPSHOT_KEYS = [
  "officialVideoSnapshots",
  "officialAccountSnapshots",
  "officialAccountProfile",
  "officialVideo",
  "snapshots",
  "profileSnapshots",
];

export function createPublishRecordStore({
  workDir,
  databasePath,
  database,
  now = () => Date.now(),
} = {}) {
  if (!workDir && !databasePath && !database) throw new Error("Publish record store needs a workDir or database.");
  const resolvedPath = databasePath || officialHistoryDatabasePath(workDir);
  const owned = !database;
  const db = database || openOfficialHistoryDatabase(resolvedPath);
  ensureStoreIdentity(db, { workDir: workDir || resolvedPath });

  function sourceStoreId() {
    return getSourceStoreId(db);
  }

  function getRecord(key, { attachLatest = false, attachHistory = false } = {}) {
    const recordKey = String(key || "").trim();
    if (!recordKey) return null;
    const row = db.prepare("SELECT * FROM publishing_records WHERE record_key = ?").get(recordKey);
    return row ? hydrateRow(row, { attachLatest, attachHistory }) : null;
  }

  function getRecordDetail(key) {
    return getRecord(key, { attachLatest: true, attachHistory: true });
  }

  function upsertRecords(records, { skipOutbox = false, operation = "upsert" } = {}) {
    const items = Array.isArray(records) ? records : [];
    const results = [];
    for (const item of items) results.push(writeRecord(item, { skipOutbox, operation }));
    return results;
  }

  function patchRecords(patches, { skipOutbox = false } = {}) {
    const items = Array.isArray(patches) ? patches : [];
    const results = [];
    for (const patch of items) {
      const key = officialRecordKey(patch);
      if (!key) {
        throw Object.assign(new Error("Official publish patch is missing a record id."), { code: "RECORD_ID_MISSING", record: patch });
      }
      const current = getRecord(key);
      if (!current) {
        results.push(writeRecord(patch, { skipOutbox, operation: "upsert" }));
        continue;
      }
      results.push(writeRecord({ ...current, ...patch, id: key }, { skipOutbox, operation: "upsert" }));
    }
    return results;
  }

  function listRecords({
    provider = "official",
    status = "",
    connectionId = "",
    query = "",
    from = 0,
    cursor = "",
    limit = 0,
    attachLatest = false,
    attachHistory = false,
  } = {}) {
    const params = [String(provider || "official")];
    let sql = "SELECT * FROM publishing_records WHERE provider = ?";
    if (status) {
      sql += " AND status = ?";
      params.push(String(status));
    }
    if (connectionId) {
      sql += " AND connection_id = ?";
      params.push(String(connectionId));
    }
    if (from) {
      sql += " AND created_at >= ?";
      params.push(Number(from) || 0);
    }
    const parsedCursor = parseListCursor(cursor);
    if (parsedCursor) {
      sql += " AND (created_at < ? OR (created_at = ? AND record_key < ?))";
      params.push(parsedCursor.createdAt, parsedCursor.createdAt, parsedCursor.recordKey);
    }
    if (query) {
      sql += " AND (lower(record_json) LIKE ? OR lower(file_name) LIKE ? OR lower(account_username) LIKE ? OR lower(video_id) LIKE ? OR lower(public_id) LIKE ?)";
      const needle = `%${String(query).trim().toLowerCase()}%`;
      params.push(needle, needle, needle, needle, needle);
    }
    sql += " ORDER BY created_at DESC, record_key DESC";
    const cap = Math.max(0, Math.floor(Number(limit) || 0));
    if (cap > 0) {
      sql += " LIMIT ?";
      params.push(cap);
    }
    const rows = db.prepare(sql).all(...params);
    const records = rows.map((row) => hydrateRow(row, { attachLatest, attachHistory }));
    const nextCursor = cap > 0 && rows.length === cap
      ? encodeListCursor(rows[rows.length - 1])
      : "";
    return { records, nextCursor, count: records.length };
  }

  function summarizeRecords({ rangeFrom = 0, query = "" } = {}) {
    const { records } = listRecords({ from: rangeFrom, query, attachLatest: true });
    const batchIds = new Set();
    for (const record of records) {
      for (const id of [...(record.officialBatchIds || []), ...(record.taskIds || []), record.batchId].filter(Boolean)) {
        batchIds.add(String(id));
      }
    }
    return {
      records,
      summary: {
        recordCount: records.length,
        batchCount: batchIds.size,
        accountCount: new Set(records.map((item) => item.connectionId || item.accountName || item.username).filter(Boolean)).size,
        submittedCount: records.filter((item) => ["submitted", "done", "published"].includes(String(item.status || ""))).length,
        taskCount: records.length,
      },
    };
  }

  function findByDedupeKey(dedupeKey) {
    const key = String(dedupeKey || "").trim();
    if (!key) return null;
    const row = db.prepare("SELECT * FROM publishing_records WHERE dedupe_key = ? LIMIT 1").get(key);
    return row ? hydrateRow(row) : null;
  }

  function findByFileName(fileName) {
    const name = String(fileName || "").trim();
    if (!name) return [];
    return db.prepare("SELECT * FROM publishing_records WHERE file_name = ?").all(name).map((row) => hydrateRow(row));
  }

  function listFileRetentionRecords() {
    return db.prepare(`
      SELECT record_key, file_name, status, updated_at, scheduled_at
      FROM publishing_records
      WHERE file_name != ''
    `).all().map((row) => ({
      id: row.record_key,
      fileName: row.file_name,
      status: row.status,
      updatedAt: Number(row.updated_at) || 0,
      scheduleAt: Number(row.scheduled_at) || 0,
    }));
  }

  function listDueOfficialRecords(currentTime = now()) {
    const cutoff = currentTime - SNAPSHOT_TRACKING_DAYS * DAY_MS;
    const dateKey = beijingDateKey(currentTime);
    const rows = db.prepare(`
      SELECT r.*
      FROM publishing_records r
      WHERE r.provider = 'official'
        AND r.status NOT IN ('failed', 'rejected', 'status_timeout', 'needs_review', 'canceled', 'cancelled')
        AND (
          (r.scheduled_at > 0 AND r.scheduled_at * 1000 <= ?)
          OR (r.scheduled_at <= 0 AND r.created_at > 0 AND r.created_at <= ?)
        )
        AND (
          r.status != 'published'
          OR r.video_id = ''
          OR COALESCE(r.published_at, 0) = 0
          OR COALESCE(r.published_at, r.created_at, 0) >= ?
        )
    `).all(currentTime, currentTime, cutoff);
    return rows
      .map((row) => hydrateRow(row))
      .filter((record) => isDueOfficialRecord(record, currentTime, (item, snapshotDate) => {
        const accountKey = accountKeyFromConnectionId(item.connectionId || item.assignedEnvId);
        const videoId = String(item.videoId || "").trim();
        if (!videoId || !accountKey) return false;
        return hasVideoSnapshotForDate(db, { videoId, accountKey, snapshotDate: snapshotDate || dateKey });
      }));
  }

  function hasVideoSnapshot(record, dateKey) {
    const accountKey = accountKeyFromConnectionId(record?.connectionId || record?.assignedEnvId);
    const videoId = String(record?.videoId || "").trim();
    return hasVideoSnapshotForDate(db, { videoId, accountKey, snapshotDate: dateKey });
  }

  function readOutboxPage({ afterSeq = 0, throughSeq = 0, limit = DEFAULT_PAGE_LIMIT, maxBytes = DEFAULT_OUTBOX_BYTES } = {}) {
    const after = Math.max(0, Number(afterSeq) || 0);
    const upper = Math.max(after, Number(throughSeq) || 0);
    if (!upper) return { events: [], throughSeq: after, bytes: 0, oversized: false };
    const rows = db.prepare(`
      SELECT seq, record_key, record_revision, operation, payload_json, created_at
      FROM publishing_outbox
      WHERE seq > ? AND seq <= ?
      ORDER BY seq
      LIMIT ?
    `).all(after, upper, Math.max(1, Number(limit) || DEFAULT_PAGE_LIMIT) + 1);
    const events = [];
    let bytes = 2;
    for (const row of rows) {
      const event = {
        seq: Number(row.seq),
        recordKey: String(row.record_key),
        recordRevision: Number(row.record_revision) || 0,
        operation: String(row.operation || "upsert"),
        record: JSON.parse(row.payload_json),
        createdAt: Number(row.created_at) || 0,
      };
      const encoded = Buffer.byteLength(JSON.stringify(event), "utf8");
      if (encoded > maxBytes && !events.length) {
        return { events: [event], throughSeq: event.seq, bytes: encoded, oversized: true };
      }
      if (bytes + encoded > maxBytes) break;
      events.push(event);
      bytes += encoded + (events.length > 1 ? 1 : 0);
      if (events.length >= (Number(limit) || DEFAULT_PAGE_LIMIT)) break;
    }
    return {
      events,
      throughSeq: events.length ? events[events.length - 1].seq : after,
      bytes,
      oversized: false,
    };
  }

  function maxOutboxSeq() {
    const row = db.prepare("SELECT MAX(seq) AS max_seq FROM publishing_outbox").get();
    return Number(row?.max_seq) || 0;
  }

  function getSyncState(destinationKey) {
    const key = String(destinationKey || "").trim();
    const row = db.prepare("SELECT * FROM publishing_sync_state WHERE destination_key = ?").get(key);
    return {
      destinationKey: key,
      sourceStoreId: sourceStoreId(),
      ackedSeq: Number(row?.acked_seq) || 0,
      updatedAt: Number(row?.updated_at) || 0,
    };
  }

  function ackOutboxPage(destinationKey, throughSeq, expectedSourceStoreId = "") {
    const key = String(destinationKey || "").trim();
    const seq = Math.max(0, Number(throughSeq) || 0);
    const source = sourceStoreId();
    if (expectedSourceStoreId && expectedSourceStoreId !== source) {
      throw Object.assign(new Error("Publish record ACK sourceStoreId does not match this database."), {
        code: "SOURCE_STORE_MISMATCH",
      });
    }
    const current = getSyncState(key);
    if (seq < current.ackedSeq) return current;
    db.prepare(`
      INSERT INTO publishing_sync_state (destination_key, source_store_id, acked_seq, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(destination_key) DO UPDATE SET
        source_store_id = excluded.source_store_id,
        acked_seq = excluded.acked_seq,
        updated_at = excluded.updated_at
    `).run(key, source, seq, now());
    return getSyncState(key);
  }

  function acquireSyncLease(destinationKey, { ownerToken = crypto.randomUUID(), ttlMs = 120_000 } = {}) {
    const key = String(destinationKey || "").trim();
    const currentTime = now();
    const row = db.prepare("SELECT * FROM publishing_sync_lease WHERE destination_key = ?").get(key);
    if (row && Number(row.expires_at) > currentTime && row.owner_token !== ownerToken) {
      return { acquired: false, ownerToken: String(row.owner_token), expiresAt: Number(row.expires_at) };
    }
    db.prepare(`
      INSERT INTO publishing_sync_lease (destination_key, owner_token, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(destination_key) DO UPDATE SET
        owner_token = excluded.owner_token,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(key, ownerToken, currentTime + ttlMs, currentTime);
    return { acquired: true, ownerToken, expiresAt: currentTime + ttlMs };
  }

  function releaseSyncLease(destinationKey, ownerToken) {
    db.prepare("DELETE FROM publishing_sync_lease WHERE destination_key = ? AND owner_token = ?")
      .run(String(destinationKey || ""), String(ownerToken || ""));
  }

  function pruneAckedOutbox({ retentionMs = OUTBOX_RETENTION_MS } = {}) {
    const destinations = db.prepare("SELECT COUNT(*) AS n FROM publishing_sync_state").get();
    if (!Number(destinations?.n)) return { deleted: 0 };
    const minAck = db.prepare("SELECT MIN(acked_seq) AS min_seq FROM publishing_sync_state").get();
    const cutoffSeq = Number(minAck?.min_seq) || 0;
    if (!cutoffSeq) return { deleted: 0 };
    const cutoffAt = now() - retentionMs;
    const result = db.prepare(`
      DELETE FROM publishing_outbox
      WHERE seq <= ? AND created_at < ?
    `).run(cutoffSeq, cutoffAt);
    return { deleted: Number(result.changes) || 0 };
  }

  function rebuildOutbox({ destinationKey = "", resetAck = true } = {}) {
    const createdAt = now();
    return withImmediateTransaction(db, () => {
      const rows = db.prepare("SELECT * FROM publishing_records WHERE provider = 'official' ORDER BY record_key").all();
      const insert = db.prepare(`
        INSERT INTO publishing_outbox (record_key, record_revision, operation, payload_json, created_at)
        VALUES (?, ?, 'rebuild', ?, ?)
      `);
      for (const row of rows) {
        insert.run(row.record_key, row.revision, JSON.stringify(compactOfficialPublishRecord(hydrateRow(row))), createdAt);
      }
      if (resetAck && destinationKey) {
        db.prepare(`
          INSERT INTO publishing_sync_state (destination_key, source_store_id, acked_seq, updated_at)
          VALUES (?, ?, 0, ?)
          ON CONFLICT(destination_key) DO UPDATE SET acked_seq = 0, source_store_id = excluded.source_store_id, updated_at = excluded.updated_at
        `).run(String(destinationKey), sourceStoreId(), createdAt);
      }
      return { rebuilt: rows.length, maxSeq: maxOutboxSeq() };
    });
  }

  function resetIdentity(reason = "manual_reset") {
    return resetSourceStoreIdentity(db, { workDir: workDir || resolvedPath, reason });
  }

  function explainPlans() {
    return {
      listPage: explain("SELECT * FROM publishing_records WHERE provider = ? AND (created_at < ? OR (created_at = ? AND record_key < ?)) ORDER BY created_at DESC, record_key DESC LIMIT 200"),
      due: explain("SELECT r.* FROM publishing_records r WHERE r.provider = 'official' AND r.status NOT IN ('failed', 'rejected') AND r.scheduled_at * 1000 <= ?"),
      outbox: explain("SELECT seq, record_key, record_revision, operation, payload_json, created_at FROM publishing_outbox WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT 200"),
      fileName: explain("SELECT * FROM publishing_records WHERE file_name = ?"),
      videoSnapshot: explain("SELECT 1 AS found FROM video_daily_snapshots WHERE video_id = ? AND account_key = ? AND snapshot_date = ? LIMIT 1"),
    };
  }

  function writeRecord(incoming, { skipOutbox = false, operation = "upsert" } = {}) {
    return withImmediateTransaction(db, () => writeRecordInTransaction(incoming, { skipOutbox, operation }));
  }

  function writeRecordInTransaction(incoming, { skipOutbox = false, operation = "upsert" } = {}) {
    if (!incoming || typeof incoming !== "object") {
      throw Object.assign(new Error("Official publish record is missing."), { code: "RECORD_INVALID" });
    }
    const normalized = normalizeOfficialPublishRecord(incoming);
    const key = officialRecordKey(normalized);
    if (!key) {
      throw Object.assign(new Error("Official publish record is missing a stable id."), {
        code: "RECORD_ID_MISSING",
        record: incoming,
      });
    }
    if (!isOfficialTikTokPublishRecord(normalized) && String(normalized.provider || "") !== "official") {
      throw Object.assign(new Error("Refusing to store a non-official publish record in the official store."), {
        code: "RECORD_NOT_OFFICIAL",
        recordKey: key,
      });
    }
    const existing = db.prepare("SELECT * FROM publishing_records WHERE record_key = ?").get(key);
    const previous = existing ? hydrateRow(existing) : null;
    const merged = previous ? mergeOfficialRecordFields(previous, normalized) : normalized;
    const slim = slimOfficialRecord(merged);
    if (previous?.createdAt) slim.createdAt = Number(previous.createdAt) || slim.createdAt;
    const snapshots = collectRecordSnapshots(incoming, slim, now());
    persistRecordSnapshots(snapshots);
    const nextRevision = (Number(existing?.revision) || 0) + 1;
    const syncPayload = compactOfficialPublishRecord(slim);
    const previousPayload = existing ? compactOfficialPublishRecord(hydrateRow(existing)) : null;
    const payloadChanged = !previousPayload || stableStringify(syncPayload) !== stableStringify(previousPayload);
    const revision = payloadChanged || !existing ? nextRevision : Number(existing.revision) || 1;
    if (payloadChanged || !existing) {
      const scheduledAt = toSeconds(slim.scheduleAt);
      db.prepare(`
        INSERT INTO publishing_records (
          record_key, public_id, provider, connection_id, account_key, account_username, video_id,
          task_id, batch_id, external_ref, dedupe_key, file_name, status, created_at, updated_at,
          scheduled_at, published_at, revision, record_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(record_key) DO UPDATE SET
          public_id = excluded.public_id,
          provider = excluded.provider,
          connection_id = excluded.connection_id,
          account_key = excluded.account_key,
          account_username = excluded.account_username,
          video_id = excluded.video_id,
          task_id = excluded.task_id,
          batch_id = excluded.batch_id,
          external_ref = excluded.external_ref,
          dedupe_key = excluded.dedupe_key,
          file_name = excluded.file_name,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          scheduled_at = excluded.scheduled_at,
          published_at = excluded.published_at,
          revision = excluded.revision,
          record_json = excluded.record_json
      `).run(
        key,
        slim.id,
        slim.provider || "official",
        String(slim.connectionId || ""),
        accountKeyFromConnectionId(slim.connectionId || slim.assignedEnvId),
        String(slim.accountUsername || slim.username || ""),
        String(slim.videoId || ""),
        String(slim.autoTaskId || slim.taskId || ""),
        String(slim.batchId || ""),
        String(slim.externalRef || ""),
        String(slim.dedupeKey || key),
        String(slim.fileName || ""),
        String(slim.status || ""),
        Number(slim.createdAt) || officialRecordTime(slim) || now(),
        Number(slim.updatedAt) || now(),
        scheduledAt,
        toMillis(slim.publishedAt) || 0,
        revision,
        JSON.stringify(slim),
      );
      if (!skipOutbox && payloadChanged) {
        db.prepare(`
          INSERT INTO publishing_outbox (record_key, record_revision, operation, payload_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(key, revision, operation, JSON.stringify(syncPayload), now());
      }
    }
    return getRecord(key);
  }

  function persistRecordSnapshots(snapshots) {
    for (const account of snapshots.accounts) upsertAccountSnapshot(db, account);
    for (const video of snapshots.videos) upsertVideoSnapshot(db, video);
  }

  function hydrateRow(row, { attachLatest = false, attachHistory = false } = {}) {
    const stored = JSON.parse(row.record_json || "{}");
    const record = {
      ...stored,
      id: row.public_id || row.record_key,
      provider: row.provider,
      connectionId: row.connection_id || stored.connectionId || "",
      videoId: row.video_id || stored.videoId || "",
      status: row.status || stored.status || "",
      createdAt: Number(row.created_at) || stored.createdAt || 0,
      updatedAt: Number(row.updated_at) || stored.updatedAt || 0,
      scheduleAt: Number(row.scheduled_at) || stored.scheduleAt || 0,
      publishedAt: Number(row.published_at) || stored.publishedAt || 0,
      dedupeKey: row.dedupe_key || stored.dedupeKey || "",
      fileName: row.file_name || stored.fileName || "",
      batchId: row.batch_id || stored.batchId || "",
      externalRef: row.external_ref || stored.externalRef || "",
      revision: Number(row.revision) || 0,
    };
    const accountKey = row.account_key || accountKeyFromConnectionId(record.connectionId);
    if (attachLatest || attachHistory) {
      const video = loadLatestVideo(db, { videoId: record.videoId, accountKey });
      if (video) record.officialVideo = video;
      const profile = loadLatestAccount(db, accountKey);
      if (profile) record.officialAccountProfile = profile;
    }
    if (attachHistory) {
      record.officialVideoSnapshots = loadVideoSnapshots(db, { videoId: record.videoId, accountKey });
      record.officialAccountSnapshots = loadAccountSnapshots(db, accountKey);
    }
    return record;
  }

  function explain(sql) {
    return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => String(row.detail || ""));
  }

  function close() {
    if (owned) closeOfficialHistoryDatabase(resolvedPath);
  }

  return {
    database: db,
    databasePath: resolvedPath,
    sourceStoreId,
    getRecord,
    getRecordDetail,
    upsertRecords,
    upsertRecordInTransaction: writeRecordInTransaction,
    patchRecords,
    listRecords,
    summarizeRecords,
    findByDedupeKey,
    findByFileName,
    listFileRetentionRecords,
    listDueOfficialRecords,
    hasVideoSnapshot,
    readOutboxPage,
    maxOutboxSeq,
    getSyncState,
    ackOutboxPage,
    acquireSyncLease,
    releaseSyncLease,
    pruneAckedOutbox,
    rebuildOutbox,
    resetIdentity,
    explainPlans,
    persistRecordSnapshots,
    close,
  };
}

export function slimOfficialRecord(record) {
  const normalized = normalizeOfficialPublishRecord(record) || { ...record };
  const slim = stripNestedSnapshotLists(normalized);
  for (const key of SNAPSHOT_KEYS) delete slim[key];
  return slim;
}

export function collectRecordSnapshots(incoming, record, currentTime = Date.now()) {
  const accountKey = accountKeyFromConnectionId(record?.connectionId || record?.assignedEnvId || incoming?.connectionId);
  const videoId = String(record?.videoId || incoming?.videoId || "").trim();
  const accounts = [];
  const videos = [];
  const accountSnapshots = [
    ...(Array.isArray(incoming?.officialAccountSnapshots) ? incoming.officialAccountSnapshots : []),
    ...(incoming?.officialAccountProfile ? [{
      ...incoming.officialAccountProfile,
      snapshotDate: incoming.officialAccountProfile.snapshotDate || beijingDateKey(Number(incoming.officialAccountProfile.syncedAt || currentTime)),
      syncedAt: Number(incoming.officialAccountProfile.syncedAt || currentTime),
    }] : []),
  ];
  for (const snapshot of accountSnapshots) {
    const snapshotDate = String(snapshot?.snapshotDate || (Number(snapshot?.syncedAt) ? beijingDateKey(Number(snapshot.syncedAt)) : "")).trim();
    if (!accountKey || !snapshotDate) {
      if (snapshot && typeof snapshot === "object") {
        throw Object.assign(new Error("Official account snapshot is missing account_key or snapshot_date."), {
          code: "SNAPSHOT_IDENTITY_MISSING",
          recordId: record?.id || "",
        });
      }
      continue;
    }
    accounts.push({
      ...snapshot,
      account_key: accountKey,
      snapshot_date: snapshotDate,
      synced_at: Number(snapshot.syncedAt || snapshot.synced_at || currentTime),
      profile: snapshot,
    });
  }
  const videoSnapshots = [
    ...(Array.isArray(incoming?.officialVideoSnapshots) ? incoming.officialVideoSnapshots : []),
    ...(incoming?.officialVideo ? [{
      ...incoming.officialVideo,
      snapshotDate: incoming.officialVideo.snapshotDate || beijingDateKey(Number(incoming.officialVideo.syncedAt || currentTime)),
      syncedAt: Number(incoming.officialVideo.syncedAt || currentTime),
    }] : []),
  ];
  for (const snapshot of videoSnapshots) {
    const id = String(snapshot?.id || snapshot?.videoId || videoId || "").trim();
    const snapshotDate = String(snapshot?.snapshotDate || (Number(snapshot?.syncedAt) ? beijingDateKey(Number(snapshot.syncedAt)) : "")).trim();
    if (!id || !accountKey || !snapshotDate) {
      throw Object.assign(new Error("Official video snapshot is missing video_id, account_key or snapshot_date."), {
        code: "SNAPSHOT_IDENTITY_MISSING",
        recordId: record?.id || "",
        videoId: id,
      });
    }
    videos.push({
      ...snapshot,
      video_id: id,
      account_key: accountKey,
      snapshot_date: snapshotDate,
      synced_at: Number(snapshot.syncedAt || snapshot.synced_at || currentTime),
      video: snapshot,
    });
  }
  return { accounts, videos };
}

export function isDueOfficialRecord(record, currentTime, hasVideoSnapshot) {
  if (!record || !isOfficialTikTokPublishRecord(record) && String(record.provider || "") !== "official") return false;
  if (TERMINAL_FAILURES.has(String(record.status || "").toLowerCase())) return false;
  const scheduledAt = Math.max(0, Number(record.scheduleAt || 0) * 1000 || Number(record.createdAt || 0));
  if (!(scheduledAt > 0) || scheduledAt > currentTime) return false;
  const sameDay = beijingDateKey(currentTime) <= beijingDateKey(scheduledAt);
  if (sameDay) {
    if (String(record.status || "").toLowerCase() === "published") return !String(record.videoId || "").trim();
    return true;
  }
  if (String(record.status || "").toLowerCase() !== "published") return true;
  const publishedAt = Math.max(0, Number(record.publishedAt || record.completedAt || scheduledAt));
  if (currentTime - publishedAt > SNAPSHOT_TRACKING_DAYS * DAY_MS) return false;
  const dateKey = beijingDateKey(currentTime);
  if (typeof hasVideoSnapshot === "function") return !hasVideoSnapshot(record, dateKey);
  return !hasSnapshotForDate(record.officialVideoSnapshots, dateKey);
}

function hasSnapshotForDate(values, dateKey) {
  return (Array.isArray(values) ? values : []).some((value) => String(value?.snapshotDate || "") === dateKey);
}

function parseListCursor(cursor) {
  const raw = String(cursor || "").trim();
  if (!raw) return null;
  const [createdAt, recordKey] = raw.split("|");
  if (!recordKey) return null;
  return { createdAt: Number(createdAt) || 0, recordKey };
}

function encodeListCursor(row) {
  return `${Number(row.created_at) || 0}|${row.record_key}`;
}

function toMillis(value) {
  const number = Number(value) || 0;
  if (number <= 0) return 0;
  return number < 1e12 ? number * 1000 : number;
}

function toSeconds(value) {
  const number = Number(value) || 0;
  if (number <= 0) return 0;
  return number > 1e12 ? Math.floor(number / 1000) : number;
}
