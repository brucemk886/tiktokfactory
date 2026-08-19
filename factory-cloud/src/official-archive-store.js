import {
  accountVideoObjectKey,
  buildAccountRow,
  packAccountVideos,
  unpackAccountVideos,
} from "../../scripts/official-archive-snapshot.js";
import { buildArchiveOperationSignals, mapArchiveVideoRow } from "../../scripts/official-archive-signals.js";
import { signalDesk } from "./signal-desk.js";

const BATCH_SIZE = 40;
const R2_CONCURRENCY = 8;

export async function refreshOfficialArchive(env, db) {
  const accounts = [];
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ limit: "20", videosPerAccount: "100" });
    if (cursor) params.set("cursor", cursor);
    const data = await signalDesk(env, db, `/api/integrations/local-factory/archive?${params}`);
    accounts.push(...(data.accounts || []));
    if (!data.hasMore || !data.nextCursor || data.nextCursor === cursor) break;
    cursor = data.nextCursor;
  }
  if (!accounts.length) {
    await db.prepare(`
      INSERT INTO official_archive_meta (id, archive_date, archive_at, account_count, video_count, updated_at, error)
      VALUES ('latest', '', ?, 0, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, error = excluded.error
    `).bind(Date.now(), Date.now(), "主站归档没有返回账号。").run();
    return readArchiveMeta(db);
  }
  await writeArchiveSnapshot(env, db, accounts);
  return readArchiveMeta(db);
}

export async function getOfficialOperationSignals(env, db, options = {}) {
  const meta = await readArchiveMeta(db);
  const accountRows = await listLatestArchiveAccounts(db);
  const requested = Array.isArray(options.accountKeys) ? options.accountKeys.filter(Boolean) : null;
  const scopedRows = requested?.length
    ? accountRows.filter((row) => requested.includes(row.account_key))
    : accountRows;
  const safeVideos = Math.max(1, Math.min(100, Math.floor(Number(options.videosPerAccount) || 100)));
  const videosByAccount = await loadVideosForAccounts(env, db, scopedRows.map((row) => row.account_key), safeVideos);
  return buildArchiveOperationSignals({
    accountRows: scopedRows,
    videosForAccount: (accountKey) => videosByAccount.get(accountKey) || [],
    archiveDate: meta.archiveDate,
    archiveAt: meta.archiveAt,
    ...options,
  });
}

export async function listLatestArchiveAccounts(db) {
  await backfillAccountMetricsFromD1(db);
  return (await db.prepare("SELECT * FROM official_accounts_latest ORDER BY label COLLATE NOCASE").all()).results || [];
}

async function backfillAccountMetricsFromD1(db) {
  const pending = await db.prepare(`
    SELECT COUNT(*) AS n FROM official_accounts_latest WHERE video_count = 0
  `).first();
  const leftover = await db.prepare("SELECT COUNT(*) AS n FROM official_videos_latest").first();
  if (!Number(pending?.n) || !Number(leftover?.n)) return;
  const { results } = await db.prepare(`
    SELECT account_key,
      COUNT(*) AS video_count,
      COALESCE(SUM(views), 0) AS views,
      COALESCE(SUM(likes), 0) AS likes,
      COALESCE(SUM(comments), 0) AS comments,
      COALESCE(SUM(shares), 0) AS shares,
      COALESCE(SUM(reach), 0) AS reach
    FROM official_videos_latest
    GROUP BY account_key
  `).all();
  if (!results?.length) return;
  const statement = db.prepare(`
    UPDATE official_accounts_latest
    SET video_count = ?, views = ?, likes = ?, comments = ?, shares = ?, reach = ?
    WHERE account_key = ?
  `);
  for (const slice of chunk(results, BATCH_SIZE)) {
    await db.batch(slice.map((row) => statement.bind(
      row.video_count, row.views, row.likes, row.comments, row.shares, row.reach, row.account_key
    )));
  }
}

export async function loadLatestArchiveVideosByAccount(env, db, videosPerAccount = 80) {
  const rows = await listLatestArchiveAccounts(db);
  return loadVideosForAccounts(env, db, rows.map((row) => row.account_key), videosPerAccount);
}

export async function loadVideosForAccounts(env, db, accountKeys = [], videosPerAccount = 80) {
  const keys = Array.from(new Set((accountKeys || []).map((key) => String(key || "").trim()).filter(Boolean)));
  const videosByAccount = new Map();
  const missing = [];
  for (const batch of chunk(keys, R2_CONCURRENCY)) {
    const packs = await Promise.all(batch.map((accountKey) => readAccountVideos(env, accountKey)));
    batch.forEach((accountKey, index) => {
      if (packs[index]) videosByAccount.set(accountKey, unpackAccountVideos(packs[index], videosPerAccount));
      else missing.push(accountKey);
    });
  }
  if (missing.length) {
    const fromD1 = await loadVideosFromD1(db, missing, videosPerAccount);
    for (const [accountKey, videos] of fromD1.entries()) {
      videosByAccount.set(accountKey, videos);
      const row = (await db.prepare("SELECT snapshot_date, synced_at FROM official_accounts_latest WHERE account_key = ?").bind(accountKey).first()) || {};
      await writeAccountVideos(env, accountKey, videos, row);
    }
  }
  return videosByAccount;
}

export function accountsFromLatestArchive(accountRows = [], videosByAccount = new Map()) {
  return accountRows.map((row) => {
    let profile = {};
    try {
      profile = JSON.parse(row.profile_json || "{}") || {};
    } catch {
      profile = {};
    }
    const syncedAt = Number(row.synced_at || 0);
    return {
      schema: row.account_key,
      accountKey: row.account_key,
      label: row.label,
      username: profile.username || row.label,
      profile,
      snapshotDate: row.snapshot_date || "",
      latestSyncAt: syncedAt,
      archiveFetchedAt: syncedAt,
      videoCount: Number(row.video_count || 0),
      views: Number(row.views || 0),
      likes: Number(row.likes || 0),
      comments: Number(row.comments || 0),
      shares: Number(row.shares || 0),
      reach: Number(row.reach || 0),
      videos: videosByAccount.get(row.account_key) || [],
      error: row.error || "",
    };
  });
}

export async function readArchiveMeta(db) {
  const row = await db.prepare("SELECT * FROM official_archive_meta WHERE id = 'latest'").first();
  return {
    archiveDate: String(row?.archive_date || ""),
    archiveAt: Number(row?.archive_at || 0),
    accountCount: Number(row?.account_count || 0),
    videoCount: Number(row?.video_count || 0),
    updatedAt: Number(row?.updated_at || 0),
    error: String(row?.error || ""),
  };
}

export async function loadAccountAssignments(db) {
  const { results } = await db.prepare("SELECT account_key, group_id FROM official_account_assignments").all();
  const assignments = {};
  for (const row of results || []) {
    if (row.account_key && row.group_id) assignments[row.account_key] = row.group_id;
  }
  return assignments;
}

export async function saveAccountAssignments(db, assignments = {}) {
  const stamp = Date.now();
  const entries = Object.entries(assignments).filter(([key, groupId]) => key && groupId);
  const keep = new Set(entries.map(([key]) => key));
  const existing = (await db.prepare("SELECT account_key FROM official_account_assignments").all()).results || [];
  const statements = entries.map(([accountKey, groupId]) => db.prepare(`
    INSERT INTO official_account_assignments (account_key, group_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(account_key) DO UPDATE SET group_id = excluded.group_id, updated_at = excluded.updated_at
  `).bind(accountKey, groupId, stamp));
  for (const row of existing) {
    if (!keep.has(row.account_key)) {
      statements.push(db.prepare("DELETE FROM official_account_assignments WHERE account_key = ?").bind(row.account_key));
    }
  }
  for (const slice of chunk(statements, BATCH_SIZE)) {
    await db.batch(slice);
  }
}

async function writeArchiveSnapshot(env, db, accounts) {
  const stamp = Date.now();
  const rows = accounts.map((account) => buildAccountRow(account, stamp)).filter((row) => row.account_key);
  const keep = new Set(rows.map((row) => row.account_key));
  let archiveDate = "";
  let archiveAt = 0;
  let videoCount = 0;
  const upserts = [];
  for (const row of rows) {
    archiveDate = row.snapshot_date > archiveDate ? row.snapshot_date : archiveDate;
    archiveAt = Math.max(archiveAt, row.synced_at);
    videoCount += row.video_count;
    upserts.push(db.prepare(`
      INSERT INTO official_accounts_latest (
        account_key, snapshot_date, synced_at, label, profile_json, error,
        video_count, views, likes, comments, shares, reach
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_key) DO UPDATE SET
        snapshot_date = excluded.snapshot_date,
        synced_at = excluded.synced_at,
        label = excluded.label,
        profile_json = excluded.profile_json,
        error = excluded.error,
        video_count = excluded.video_count,
        views = excluded.views,
        likes = excluded.likes,
        comments = excluded.comments,
        shares = excluded.shares,
        reach = excluded.reach
    `).bind(
      row.account_key,
      row.snapshot_date,
      row.synced_at,
      row.label,
      row.profile_json,
      row.error,
      row.video_count,
      row.views,
      row.likes,
      row.comments,
      row.shares,
      row.reach
    ));
  }
  for (const slice of chunk(upserts, BATCH_SIZE)) {
    await db.batch(slice);
  }
  for (const slice of chunk(rows, R2_CONCURRENCY)) {
    await Promise.all(slice.map((row) => writeAccountVideos(env, row.account_key, row.videos, row)));
  }
  const existing = (await db.prepare("SELECT account_key FROM official_accounts_latest").all()).results || [];
  const stale = existing.map((row) => row.account_key).filter((key) => !keep.has(key));
  for (const slice of chunk(stale, BATCH_SIZE)) {
    await db.batch(slice.flatMap((accountKey) => [
      db.prepare("DELETE FROM official_accounts_latest WHERE account_key = ?").bind(accountKey),
      db.prepare("DELETE FROM official_account_assignments WHERE account_key = ?").bind(accountKey),
    ]));
    await Promise.all(slice.map((accountKey) => deleteAccountVideos(env, accountKey)));
  }
  await db.prepare("DELETE FROM official_videos_latest").run();
  await db.prepare(`
    INSERT INTO official_archive_meta (id, archive_date, archive_at, account_count, video_count, updated_at, error)
    VALUES ('latest', ?, ?, ?, ?, ?, '')
    ON CONFLICT(id) DO UPDATE SET
      archive_date = excluded.archive_date,
      archive_at = excluded.archive_at,
      account_count = excluded.account_count,
      video_count = excluded.video_count,
      updated_at = excluded.updated_at,
      error = ''
  `).bind(archiveDate, archiveAt, rows.length, videoCount, stamp).run();
}

async function writeAccountVideos(env, accountKey, videos, extra = {}) {
  if (!env?.ARCHIVE) return;
  await env.ARCHIVE.put(accountVideoObjectKey(accountKey), JSON.stringify(packAccountVideos(accountKey, videos, extra)), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function readAccountVideos(env, accountKey) {
  if (!env?.ARCHIVE) return null;
  const object = await env.ARCHIVE.get(accountVideoObjectKey(accountKey));
  if (!object) return null;
  try {
    return await object.json();
  } catch {
    return null;
  }
}

async function deleteAccountVideos(env, accountKey) {
  if (!env?.ARCHIVE) return;
  await env.ARCHIVE.delete(accountVideoObjectKey(accountKey)).catch(() => {});
}

async function loadVideosFromD1(db, accountKeys, videosPerAccount) {
  const videosByAccount = new Map();
  if (!accountKeys.length) return videosByAccount;
  for (const slice of chunk(accountKeys, BATCH_SIZE)) {
    const placeholders = slice.map(() => "?").join(", ");
    const { results } = await db.prepare(`
      SELECT video_id, account_key, snapshot_date, synced_at, create_time, title, views, likes, comments, shares, reach, video_json
      FROM official_videos_latest
      WHERE account_key IN (${placeholders})
      ORDER BY create_time DESC, video_id
    `).bind(...slice).all();
    for (const row of results || []) {
      const list = videosByAccount.get(row.account_key) || [];
      if (list.length >= videosPerAccount) continue;
      list.push(mapArchiveVideoRow(row));
      videosByAccount.set(row.account_key, list);
    }
  }
  return videosByAccount;
}

function chunk(items, size) {
  const rows = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}
