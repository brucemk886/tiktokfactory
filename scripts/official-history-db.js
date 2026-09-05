import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const OFFICIAL_HISTORY_DATABASE_NAME = "official-history.sqlite";
export const PUBLISHING_SCHEMA_VERSION = 1;
const BUSY_TIMEOUT_MS = 8_000;
const sharedConnections = new Map();

export function officialHistoryDatabasePath(workDir) {
  return path.join(String(workDir || ""), "official-tiktok-history", OFFICIAL_HISTORY_DATABASE_NAME);
}

export function officialHistoryArchiveDir(workDir) {
  return path.join(String(workDir || ""), "official-tiktok-history");
}

export function openOfficialHistoryDatabase(databasePath, { shared = true } = {}) {
  const resolved = path.resolve(String(databasePath || ""));
  if (!resolved || resolved.endsWith(path.sep)) throw new Error("Official history database path is required.");
  if (shared && sharedConnections.has(resolved)) return sharedConnections.get(resolved);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const database = new DatabaseSync(resolved);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};
    PRAGMA foreign_keys = ON;
  `);
  ensureArchiveSchema(database);
  ensurePublishingSchema(database);
  repairLegacyVideoCreateTimes(database);
  if (shared) sharedConnections.set(resolved, database);
  return database;
}

export function closeOfficialHistoryDatabase(databasePath) {
  const resolved = path.resolve(String(databasePath || ""));
  const database = sharedConnections.get(resolved);
  if (!database) return;
  database.close();
  sharedConnections.delete(resolved);
}

export function withImmediateTransaction(database, callback) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw error;
  }
}

export function accountKeyFromConnectionId(value) {
  const connectionId = String(value || "").trim();
  if (!connectionId) return "";
  return connectionId.startsWith("tiktok:") ? connectionId : `tiktok:${connectionId}`;
}

export function machineFingerprint(workDir) {
  return `${os.hostname()}|${path.resolve(String(workDir || ""))}`;
}

export function ensureStoreIdentity(database, { workDir, resetIfCopied = true } = {}) {
  const now = Date.now();
  const fingerprint = machineFingerprint(workDir);
  const row = database.prepare("SELECT source_store_id, machine_fingerprint FROM publishing_store_meta WHERE id = 1").get();
  if (!row) {
    const sourceStoreId = crypto.randomUUID();
    database.prepare(`
      INSERT INTO publishing_store_meta (id, source_store_id, machine_fingerprint, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?)
    `).run(sourceStoreId, fingerprint, now, now);
    return { sourceStoreId, created: true, reset: false };
  }
  const copied = resetIfCopied && row.machine_fingerprint && row.machine_fingerprint !== fingerprint;
  if (!copied) return { sourceStoreId: String(row.source_store_id), created: false, reset: false };
  return resetSourceStoreIdentity(database, { workDir, reason: "database_copied_to_another_machine" });
}

export function resetSourceStoreIdentity(database, { workDir, reason = "manual_reset" } = {}) {
  const now = Date.now();
  const sourceStoreId = crypto.randomUUID();
  const fingerprint = machineFingerprint(workDir);
  database.prepare(`
    INSERT INTO publishing_store_meta (id, source_store_id, machine_fingerprint, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_store_id = excluded.source_store_id,
      machine_fingerprint = excluded.machine_fingerprint,
      updated_at = excluded.updated_at
  `).run(sourceStoreId, fingerprint, now, now);
  database.prepare("DELETE FROM publishing_sync_state").run();
  database.prepare("DELETE FROM publishing_sync_lease").run();
  database.prepare(`
    INSERT INTO publishing_migrations
      (id, version, batch_id, status, source_path, source_digest, error, created_at, updated_at)
    VALUES (?, ?, ?, 'identity-reset', '', '', ?, ?, ?)
  `).run(`identity-${sourceStoreId}`, PUBLISHING_SCHEMA_VERSION, reason, reason, now, now);
  return { sourceStoreId, created: false, reset: true, reason };
}

export function getSourceStoreId(database) {
  const row = database.prepare("SELECT source_store_id FROM publishing_store_meta WHERE id = 1").get();
  return row ? String(row.source_store_id) : "";
}

export function upsertAccountSnapshot(database, incoming) {
  const accountKey = String(incoming.account_key || incoming.accountKey || "").trim();
  const snapshotDate = String(incoming.snapshot_date || incoming.snapshotDate || "").trim();
  if (!accountKey || !snapshotDate) {
    throw Object.assign(new Error("Account snapshot is missing account_key or snapshot_date."), {
      code: "SNAPSHOT_IDENTITY_MISSING",
      accountKey,
      snapshotDate,
    });
  }
  const next = normalizeAccountSnapshotRow(incoming, accountKey, snapshotDate);
  const existing = database.prepare("SELECT * FROM account_daily_snapshots WHERE account_key = ? AND snapshot_date = ?")
    .get(accountKey, snapshotDate);
  const merged = existing ? mergeAccountSnapshotRows(existing, next) : next;
  database.prepare(`
    INSERT INTO account_daily_snapshots
      (account_key, snapshot_date, synced_at, label, followers, following, total_likes, reported_videos, profile_json, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_key, snapshot_date) DO UPDATE SET
      synced_at = excluded.synced_at,
      label = excluded.label,
      followers = excluded.followers,
      following = excluded.following,
      total_likes = excluded.total_likes,
      reported_videos = excluded.reported_videos,
      profile_json = excluded.profile_json,
      error = excluded.error
  `).run(
    merged.account_key, merged.snapshot_date, merged.synced_at, merged.label,
    merged.followers, merged.following, merged.total_likes, merged.reported_videos,
    merged.profile_json, merged.error,
  );
  const latest = database.prepare("SELECT snapshot_date, synced_at FROM accounts_latest WHERE account_key = ?").get(accountKey);
  if (!latest || String(merged.snapshot_date) > String(latest.snapshot_date) || (
    String(merged.snapshot_date) === String(latest.snapshot_date) && merged.synced_at >= number(latest.synced_at)
  )) {
    database.prepare(`
      INSERT INTO accounts_latest
        (account_key, snapshot_date, synced_at, label, followers, following, total_likes, reported_videos, profile_json, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_key) DO UPDATE SET
        snapshot_date = excluded.snapshot_date,
        synced_at = excluded.synced_at,
        label = excluded.label,
        followers = excluded.followers,
        following = excluded.following,
        total_likes = excluded.total_likes,
        reported_videos = excluded.reported_videos,
        profile_json = excluded.profile_json,
        error = excluded.error
    `).run(
      merged.account_key, merged.snapshot_date, merged.synced_at, merged.label,
      merged.followers, merged.following, merged.total_likes, merged.reported_videos,
      merged.profile_json, merged.error,
    );
  }
  return merged;
}

export function upsertVideoSnapshot(database, incoming) {
  const videoId = String(incoming.video_id || incoming.videoId || incoming.id || "").trim();
  const accountKey = String(incoming.account_key || incoming.accountKey || "").trim();
  const snapshotDate = String(incoming.snapshot_date || incoming.snapshotDate || "").trim();
  if (!videoId || !accountKey || !snapshotDate) {
    throw Object.assign(new Error("Video snapshot is missing video_id, account_key or snapshot_date."), {
      code: "SNAPSHOT_IDENTITY_MISSING",
      videoId,
      accountKey,
      snapshotDate,
    });
  }
  const next = normalizeVideoSnapshotRow(incoming, videoId, accountKey, snapshotDate);
  const existing = database.prepare("SELECT * FROM video_daily_snapshots WHERE video_id = ? AND account_key = ? AND snapshot_date = ?")
    .get(videoId, accountKey, snapshotDate);
  const merged = existing ? mergeVideoSnapshotRows(existing, next) : next;
  database.prepare(`
    INSERT INTO video_daily_snapshots
      (video_id, account_key, snapshot_date, synced_at, create_time, title, views, likes, comments, shares, reach, video_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id, account_key, snapshot_date) DO UPDATE SET
      synced_at = excluded.synced_at,
      create_time = excluded.create_time,
      title = excluded.title,
      views = excluded.views,
      likes = excluded.likes,
      comments = excluded.comments,
      shares = excluded.shares,
      reach = excluded.reach,
      video_json = excluded.video_json
  `).run(
    merged.video_id, merged.account_key, merged.snapshot_date, merged.synced_at, merged.create_time,
    merged.title, merged.views, merged.likes, merged.comments, merged.shares, merged.reach, merged.video_json,
  );
  const latest = database.prepare("SELECT snapshot_date, synced_at FROM videos_latest WHERE video_id = ? AND account_key = ?")
    .get(videoId, accountKey);
  if (!latest || String(merged.snapshot_date) > String(latest.snapshot_date) || (
    String(merged.snapshot_date) === String(latest.snapshot_date) && merged.synced_at >= number(latest.synced_at)
  )) {
    database.prepare(`
      INSERT INTO videos_latest
        (video_id, account_key, snapshot_date, synced_at, create_time, title, views, likes, comments, shares, reach, video_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id, account_key) DO UPDATE SET
        snapshot_date = excluded.snapshot_date,
        synced_at = excluded.synced_at,
        create_time = excluded.create_time,
        title = excluded.title,
        views = excluded.views,
        likes = excluded.likes,
        comments = excluded.comments,
        shares = excluded.shares,
        reach = excluded.reach,
        video_json = excluded.video_json
    `).run(
      merged.video_id, merged.account_key, merged.snapshot_date, merged.synced_at, merged.create_time,
      merged.title, merged.views, merged.likes, merged.comments, merged.shares, merged.reach, merged.video_json,
    );
  }
  return merged;
}

export function hasVideoSnapshotForDate(database, { videoId, accountKey, snapshotDate }) {
  const id = String(videoId || "").trim();
  const account = String(accountKey || "").trim();
  const dateKey = String(snapshotDate || "").trim();
  if (!id || !account || !dateKey) return false;
  return Boolean(database.prepare(
    "SELECT 1 AS found FROM video_daily_snapshots WHERE video_id = ? AND account_key = ? AND snapshot_date = ? LIMIT 1"
  ).get(id, account, dateKey));
}

export function loadLatestVideo(database, { videoId, accountKey }) {
  const id = String(videoId || "").trim();
  if (!id) return null;
  const account = String(accountKey || "").trim();
  const row = account
    ? database.prepare("SELECT * FROM videos_latest WHERE video_id = ? AND account_key = ?").get(id, account)
    : database.prepare("SELECT * FROM videos_latest WHERE video_id = ? ORDER BY snapshot_date DESC, synced_at DESC LIMIT 1").get(id);
  return row ? videoSnapshotFromRow(row) : null;
}

export function loadLatestAccount(database, accountKey) {
  const account = String(accountKey || "").trim();
  if (!account) return null;
  const row = database.prepare("SELECT * FROM accounts_latest WHERE account_key = ?").get(account);
  return row ? accountSnapshotFromRow(row) : null;
}

export function loadVideoSnapshots(database, { videoId, accountKey }) {
  const id = String(videoId || "").trim();
  const account = String(accountKey || "").trim();
  if (!id || !account) return [];
  return database.prepare(
    "SELECT * FROM video_daily_snapshots WHERE video_id = ? AND account_key = ? ORDER BY snapshot_date"
  ).all(id, account).map(videoSnapshotFromRow);
}

export function loadAccountSnapshots(database, accountKey) {
  const account = String(accountKey || "").trim();
  if (!account) return [];
  return database.prepare(
    "SELECT * FROM account_daily_snapshots WHERE account_key = ? ORDER BY snapshot_date"
  ).all(account).map(accountSnapshotFromRow);
}

export function stripNestedSnapshotLists(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const {
    snapshots,
    profileSnapshots,
    officialVideoSnapshots,
    officialAccountSnapshots,
    officialAccountProfile,
    officialVideo,
    ...rest
  } = value;
  return rest;
}

export function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function beijingDateKey(timestamp) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function ensureArchiveSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS archive_runs (
      date_key TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL,
      account_count INTEGER NOT NULL DEFAULT 0,
      video_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'sqlite'
    );
    CREATE TABLE IF NOT EXISTS account_daily_snapshots (
      account_key TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      synced_at INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      followers INTEGER NOT NULL DEFAULT 0,
      following INTEGER NOT NULL DEFAULT 0,
      total_likes INTEGER NOT NULL DEFAULT 0,
      reported_videos INTEGER NOT NULL DEFAULT 0,
      profile_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (account_key, snapshot_date)
    );
    CREATE INDEX IF NOT EXISTS idx_account_daily_date ON account_daily_snapshots(snapshot_date, account_key);
    CREATE TABLE IF NOT EXISTS video_daily_snapshots (
      video_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      synced_at INTEGER NOT NULL,
      create_time INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      views INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      reach INTEGER NOT NULL DEFAULT 0,
      video_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (video_id, account_key, snapshot_date)
    );
    CREATE INDEX IF NOT EXISTS idx_video_daily_history ON video_daily_snapshots(video_id, account_key, snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_video_daily_account ON video_daily_snapshots(account_key, snapshot_date, create_time DESC);
    CREATE TABLE IF NOT EXISTS accounts_latest (
      account_key TEXT PRIMARY KEY,
      snapshot_date TEXT NOT NULL,
      synced_at INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      followers INTEGER NOT NULL DEFAULT 0,
      following INTEGER NOT NULL DEFAULT 0,
      total_likes INTEGER NOT NULL DEFAULT 0,
      reported_videos INTEGER NOT NULL DEFAULT 0,
      profile_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS videos_latest (
      video_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      synced_at INTEGER NOT NULL,
      create_time INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      views INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      reach INTEGER NOT NULL DEFAULT 0,
      video_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (video_id, account_key)
    );
    CREATE INDEX IF NOT EXISTS idx_videos_latest_account ON videos_latest(account_key, create_time DESC);
    CREATE TABLE IF NOT EXISTS archive_sync_checkpoints (
      date_key TEXT PRIMARY KEY,
      cursor TEXT NOT NULL DEFAULT '',
      account_count INTEGER NOT NULL DEFAULT 0,
      video_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running',
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function ensurePublishingSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS publishing_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publishing_store_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      source_store_id TEXT NOT NULL,
      machine_fingerprint TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publishing_records (
      record_key TEXT PRIMARY KEY,
      public_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      connection_id TEXT NOT NULL DEFAULT '',
      account_key TEXT NOT NULL DEFAULT '',
      account_username TEXT NOT NULL DEFAULT '',
      video_id TEXT NOT NULL DEFAULT '',
      task_id TEXT NOT NULL DEFAULT '',
      batch_id TEXT NOT NULL DEFAULT '',
      external_ref TEXT NOT NULL DEFAULT '',
      dedupe_key TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      scheduled_at INTEGER NOT NULL DEFAULT 0,
      published_at INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      record_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_publishing_records_page
      ON publishing_records(provider, created_at DESC, record_key DESC);
    CREATE INDEX IF NOT EXISTS idx_publishing_records_due
      ON publishing_records(provider, status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_publishing_records_connection
      ON publishing_records(connection_id);
    CREATE INDEX IF NOT EXISTS idx_publishing_records_video
      ON publishing_records(video_id, account_key);
    CREATE INDEX IF NOT EXISTS idx_publishing_records_dedupe
      ON publishing_records(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_publishing_records_file
      ON publishing_records(file_name);
    CREATE TABLE IF NOT EXISTS publishing_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      record_key TEXT NOT NULL,
      record_revision INTEGER NOT NULL,
      operation TEXT NOT NULL DEFAULT 'upsert',
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_publishing_outbox_seq ON publishing_outbox(seq);
    CREATE INDEX IF NOT EXISTS idx_publishing_outbox_record ON publishing_outbox(record_key, record_revision);
    CREATE TABLE IF NOT EXISTS publishing_sync_state (
      destination_key TEXT PRIMARY KEY,
      source_store_id TEXT NOT NULL,
      acked_seq INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publishing_sync_lease (
      destination_key TEXT PRIMARY KEY,
      owner_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publishing_migrations (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      batch_id TEXT NOT NULL,
      status TEXT NOT NULL,
      source_path TEXT NOT NULL DEFAULT '',
      source_digest TEXT NOT NULL DEFAULT '',
      official_count INTEGER NOT NULL DEFAULT 0,
      geelark_count INTEGER NOT NULL DEFAULT 0,
      unknown_count INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      exception_count INTEGER NOT NULL DEFAULT 0,
      snapshot_account_count INTEGER NOT NULL DEFAULT 0,
      snapshot_video_count INTEGER NOT NULL DEFAULT 0,
      checksum TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publishing_migration_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      public_id TEXT NOT NULL DEFAULT '',
      record_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_publishing_migration_exceptions_batch
      ON publishing_migration_exceptions(batch_id, id);
  `);
  const applied = database.prepare("SELECT version FROM publishing_schema_migrations WHERE version = ?")
    .get(PUBLISHING_SCHEMA_VERSION);
  if (!applied) {
    database.prepare("INSERT INTO publishing_schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(PUBLISHING_SCHEMA_VERSION, Date.now());
  }
}

function repairLegacyVideoCreateTimes(database) {
  const tables = ["videos_latest", "video_daily_snapshots"];
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const table of tables) {
      const rows = database.prepare(`SELECT rowid, video_id, video_json FROM ${table} WHERE create_time IS NULL OR create_time <= 0`).all();
      const update = database.prepare(`UPDATE ${table} SET create_time = ? WHERE rowid = ?`);
      for (const row of rows) {
        const raw = parseJson(row.video_json, {});
        const analytics = raw?.analytics && typeof raw.analytics === "object" ? raw.analytics : {};
        const corrected = timestamp(
          raw?.createTime, raw?.createdAt, raw?.create_time, raw?.publishTime, raw?.publish_time, raw?.publishedAt, raw?.published_at,
          analytics?.createTime, analytics?.createdAt, analytics?.create_time, analytics?.publishTime, analytics?.publish_time,
          analytics?.publishedAt, analytics?.published_at,
        ) || timestampFromTikTokId(row.video_id);
        if (corrected > 0) update.run(corrected, row.rowid);
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function normalizeAccountSnapshotRow(incoming, accountKey, snapshotDate) {
  const profile = stripNestedSnapshotLists(incoming.profile && typeof incoming.profile === "object"
    ? incoming.profile
    : parseJson(incoming.profile_json, incoming));
  const syncedAt = number(incoming.synced_at || incoming.syncedAt || incoming.fetchedAt);
  return {
    account_key: accountKey,
    snapshot_date: snapshotDate,
    synced_at: syncedAt,
    label: String(incoming.label || profile?.username || profile?.displayName || "").trim(),
    followers: number(incoming.followers ?? profile?.followers),
    following: number(incoming.following ?? profile?.following),
    total_likes: number(incoming.total_likes ?? incoming.totalLikes ?? profile?.totalLikes),
    reported_videos: number(incoming.reported_videos ?? incoming.reportedVideos ?? incoming.videos ?? profile?.videos),
    profile_json: JSON.stringify(profile && typeof profile === "object" ? profile : {}),
    error: String(incoming.error || ""),
  };
}

function normalizeVideoSnapshotRow(incoming, videoId, accountKey, snapshotDate) {
  const raw = stripNestedSnapshotLists(incoming.video && typeof incoming.video === "object"
    ? incoming.video
    : parseJson(incoming.video_json, incoming));
  const analytics = raw?.analytics && typeof raw.analytics === "object" ? raw.analytics : {};
  return {
    video_id: videoId,
    account_key: accountKey,
    snapshot_date: snapshotDate,
    synced_at: number(incoming.synced_at || incoming.syncedAt || incoming.fetchedAt),
    create_time: timestamp(
      incoming.create_time, incoming.createTime, raw?.createTime, raw?.createdAt, raw?.create_time,
      raw?.publishTime, raw?.publishedAt, analytics?.createTime, analytics?.publishedAt,
    ) || timestampFromTikTokId(videoId),
    title: String(incoming.title || raw?.title || raw?.caption || raw?.description || "").trim(),
    views: number(incoming.views ?? raw?.views),
    likes: number(incoming.likes ?? raw?.likes),
    comments: number(incoming.comments ?? raw?.comments),
    shares: number(incoming.shares ?? raw?.shares),
    reach: number(incoming.reach ?? raw?.reach),
    video_json: JSON.stringify(raw && typeof raw === "object" ? raw : {}),
  };
}

function mergeAccountSnapshotRows(existing, incoming) {
  const newer = number(incoming.synced_at) >= number(existing.synced_at) ? incoming : existing;
  const older = newer === incoming ? existing : incoming;
  return {
    account_key: newer.account_key,
    snapshot_date: newer.snapshot_date,
    synced_at: Math.max(number(existing.synced_at), number(incoming.synced_at)),
    label: newer.label || older.label,
    followers: preferPositive(newer.followers, older.followers),
    following: preferPositive(newer.following, older.following),
    total_likes: preferPositive(newer.total_likes, older.total_likes),
    reported_videos: preferPositive(newer.reported_videos, older.reported_videos),
    profile_json: JSON.stringify(mergeObjects(parseJson(older.profile_json, {}), parseJson(newer.profile_json, {}))),
    error: newer.error || older.error,
  };
}

function mergeVideoSnapshotRows(existing, incoming) {
  const newer = number(incoming.synced_at) >= number(existing.synced_at) ? incoming : existing;
  const older = newer === incoming ? existing : incoming;
  return {
    video_id: newer.video_id,
    account_key: newer.account_key,
    snapshot_date: newer.snapshot_date,
    synced_at: Math.max(number(existing.synced_at), number(incoming.synced_at)),
    create_time: preferPositive(newer.create_time, older.create_time),
    title: newer.title || older.title,
    views: preferPositive(newer.views, older.views),
    likes: preferPositive(newer.likes, older.likes),
    comments: preferPositive(newer.comments, older.comments),
    shares: preferPositive(newer.shares, older.shares),
    reach: preferPositive(newer.reach, older.reach),
    video_json: JSON.stringify(mergeObjects(parseJson(older.video_json, {}), parseJson(newer.video_json, {}))),
  };
}

function preferPositive(preferred, fallback) {
  return number(preferred) || number(fallback);
}

function mergeObjects(older, newer) {
  const result = { ...(older && typeof older === "object" ? older : {}) };
  for (const [key, value] of Object.entries(newer && typeof newer === "object" ? newer : {})) {
    if (value == null) continue;
    if (value === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    if (typeof value === "number" && value === 0 && number(result[key])) continue;
    result[key] = value;
  }
  return stripNestedSnapshotLists(result);
}

function accountSnapshotFromRow(row) {
  const profile = parseJson(row.profile_json, {});
  return {
    ...profile,
    snapshotDate: String(row.snapshot_date || ""),
    syncedAt: number(row.synced_at),
    accountKey: String(row.account_key || ""),
    label: String(row.label || profile?.username || ""),
    followers: number(row.followers),
    following: number(row.following),
    totalLikes: number(row.total_likes),
    videos: number(row.reported_videos),
    error: String(row.error || ""),
  };
}

function videoSnapshotFromRow(row) {
  const raw = parseJson(row.video_json, {});
  return {
    ...raw,
    id: String(row.video_id || ""),
    videoId: String(row.video_id || ""),
    account: String(row.account_key || ""),
    snapshotDate: String(row.snapshot_date || ""),
    syncedAt: number(row.synced_at),
    createTime: number(row.create_time),
    title: String(row.title || raw?.title || ""),
    views: number(row.views),
    likes: number(row.likes),
    comments: number(row.comments),
    shares: number(row.shares),
    reach: number(row.reach),
  };
}

function timestamp(...values) {
  const min = Date.UTC(2016, 0, 1) / 1000;
  const max = (Date.now() + 14 * 86400000) / 1000;
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    let numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      while (numeric > 1e11) numeric /= 1000;
      numeric = Math.floor(numeric);
      if (numeric >= min && numeric <= max) return numeric;
    }
    const parsed = Date.parse(String(value));
    const seconds = Math.floor(parsed / 1000);
    if (Number.isFinite(seconds) && seconds >= min && seconds <= max) return seconds;
  }
  return 0;
}

function timestampFromTikTokId(value) {
  try {
    const id = String(value || "").trim();
    if (!/^\d{16,22}$/.test(id)) return 0;
    return timestamp(Number(BigInt(id) >> 32n));
  } catch {
    return 0;
  }
}
