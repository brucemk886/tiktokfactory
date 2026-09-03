import {
  accountVideoObjectKey,
  buildAccountRow,
  packAccountVideos,
  unpackAccountVideos,
} from "../../scripts/official-archive-snapshot.js";
import { buildArchiveOperationSignals, mapArchiveVideoRow } from "../../scripts/official-archive-signals.js";
import { signalDesk } from "./signal-desk.js";
import { kvGet, kvSet } from "./kv.js";

const BATCH_SIZE = 40;
const R2_CONCURRENCY = 8;
const ARCHIVE_REFRESH_CURSOR_KEY = "official-archive-refresh-cursor";
const ARCHIVE_REFRESH_PAGES_PER_RUN = 20;
const ARCHIVE_REFRESH_TIME_BUDGET_MS = 20_000;

// A single run used to walk at most 20 pages × 20 accounts from the start, so
// with more than 400 accounts the tail never got refreshed. The cursor now
// survives between runs: each run continues where the previous one stopped
// and only rewinds to the beginning once the whole list has been covered.
export async function refreshOfficialArchive(env, db, { pagesPerRun = ARCHIVE_REFRESH_PAGES_PER_RUN, timeBudgetMs = ARCHIVE_REFRESH_TIME_BUDGET_MS } = {}) {
  const startedAt = Date.now();
  const saved = await kvGet(db, ARCHIVE_REFRESH_CURSOR_KEY, null);
  let cursor = typeof saved?.cursor === "string" ? saved.cursor : "";
  let pulled = 0;
  let completed = false;
  for (let page = 0; page < Math.max(1, pagesPerRun); page += 1) {
    const params = new URLSearchParams({ limit: "20", videosPerAccount: "100" });
    if (cursor) params.set("cursor", cursor);
    const data = await signalDesk(env, db, `/api/integrations/local-factory/archive?${params}`);
    const accounts = data.accounts || [];
    if (accounts.length) {
      await upsertOfficialAccounts(env, db, accounts);
      pulled += accounts.length;
    }
    if (!data.hasMore || !data.nextCursor || data.nextCursor === cursor) {
      completed = true;
      cursor = "";
      break;
    }
    cursor = data.nextCursor;
    if (Date.now() - startedAt > timeBudgetMs) break;
  }
  await kvSet(db, ARCHIVE_REFRESH_CURSOR_KEY, { cursor, updatedAt: Date.now(), completed });
  if (!pulled && !cursor) {
    const existing = await readArchiveMeta(db);
    if (existing.accountCount) return { ...existing, pulled: 0 };
    await db.prepare(`
      INSERT INTO official_archive_meta (id, archive_date, archive_at, account_count, video_count, updated_at, error)
      VALUES ('latest', '', ?, 0, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, error = excluded.error
    `).bind(Date.now(), Date.now(), "主站归档没有返回账号。").run();
  }
  return { ...(await readArchiveMeta(db)), pulled, completed, resumeCursor: cursor };
}

export async function applyOfficialArchivePush(env, db, payload = {}) {
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const deleteAccountKeys = uniqueAccountKeys(payload.deleteAccountKeys);
  if (accounts.length) await upsertOfficialAccounts(env, db, accounts);
  if (deleteAccountKeys.length) await deleteOfficialAccounts(env, db, deleteAccountKeys);
  return readArchiveMeta(db);
}

export async function getOfficialOperationSignals(env, db, options = {}) {
  const meta = await readArchiveMeta(db);
  const accountRows = await listLatestArchiveAccounts(db);
  const requested = Array.isArray(options.accountKeys) ? options.accountKeys.filter(Boolean) : null;
  const scopedRows = requested?.length
    ? [
      ...accountRows.filter((row) => requested.includes(row.account_key)),
      ...requested
        .filter((key) => !accountRows.some((row) => row.account_key === key))
        .map((key) => ({
          account_key: key,
          label: String(key).startsWith("tiktok:") ? key.slice("tiktok:".length) : key,
          profile_json: "{}",
        })),
    ]
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

export async function loadArchiveViewsByVideoIds(db, videoIds = []) {
  const ids = [...new Set((Array.isArray(videoIds) ? videoIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
  const views = new Map();
  if (!ids.length) return views;
  for (const slice of chunk(ids, 80)) {
    const placeholders = slice.map(() => "?").join(", ");
    const { results } = await db.prepare(
      `SELECT video_id, views FROM official_videos_latest WHERE video_id IN (${placeholders})`
    ).bind(...slice).all();
    for (const row of results || []) {
      views.set(String(row.video_id), Number(row.views) || 0);
    }
  }
  return views;
}

export async function listLatestArchiveAccounts(db) {
  return (await db.prepare("SELECT * FROM official_accounts_latest ORDER BY label COLLATE NOCASE").all()).results || [];
}

export async function listAccountDirectory(db) {
  return (await db.prepare(`
    SELECT account_key, label, synced_at, video_count, views
    FROM official_accounts_latest
    ORDER BY label COLLATE NOCASE
  `).all()).results || [];
}

export function directoryUsername(row = {}) {
  const username = String(row.username || "").trim();
  if (username) return username;
  const label = String(row.label || "").trim();
  return label.startsWith("@") ? label.slice(1) : label;
}

export function directoryAccountsFromRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const username = directoryUsername(row);
    return {
      accountKey: row.account_key,
      schema: row.account_key,
      id: row.account_key,
      connectionId: row.account_key,
      label: row.label,
      username,
      profile: {
        username,
        displayName: String(row.displayName || username || "")
      },
      videoCount: Number(row.video_count || 0),
      syncedVideoCount: Number(row.video_count || 0),
      syncedAt: Number(row.synced_at || 0),
      updatedAt: Number(row.synced_at || 0),
      views: Number(row.views || 0)
    };
  });
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

export async function upsertOfficialAccounts(env, db, accounts) {
  const stamp = Date.now();
  const rows = (accounts || []).map((account) => buildAccountRow(account, stamp)).filter((row) => row.account_key);
  if (!rows.length) return readArchiveMeta(db);
  const upserts = rows.map((row) => db.prepare(`
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
  for (const slice of chunk(upserts, BATCH_SIZE)) {
    await db.batch(slice);
  }
  for (const slice of chunk(rows, R2_CONCURRENCY)) {
    await Promise.all(slice.map((row) => writeAccountVideos(env, row.account_key, row.videos, row)));
  }
  await deleteLeftoverVideos(db, rows.map((row) => row.account_key));
  return refreshArchiveMeta(db, stamp);
}

export async function deleteOfficialAccounts(env, db, accountKeys) {
  const keys = uniqueAccountKeys(accountKeys);
  if (!keys.length) return readArchiveMeta(db);
  for (const slice of chunk(keys, BATCH_SIZE)) {
    await db.batch(slice.flatMap((accountKey) => [
      db.prepare("DELETE FROM official_accounts_latest WHERE account_key = ?").bind(accountKey),
      db.prepare("DELETE FROM official_account_assignments WHERE account_key = ?").bind(accountKey),
    ]));
    await Promise.all(slice.map((accountKey) => deleteAccountVideos(env, accountKey)));
  }
  await deleteLeftoverVideos(db, keys);
  return refreshArchiveMeta(db);
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

async function refreshArchiveMeta(db, stamp = Date.now()) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS account_count,
      COALESCE(SUM(video_count), 0) AS video_count,
      COALESCE(MAX(snapshot_date), '') AS archive_date,
      COALESCE(MAX(synced_at), 0) AS archive_at
    FROM official_accounts_latest
  `).first();
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
  `).bind(
    String(row?.archive_date || ""),
    Number(row?.archive_at || 0),
    Number(row?.account_count || 0),
    Number(row?.video_count || 0),
    stamp
  ).run();
  return readArchiveMeta(db);
}

async function deleteLeftoverVideos(db, accountKeys) {
  const keys = uniqueAccountKeys(accountKeys);
  for (const slice of chunk(keys, BATCH_SIZE)) {
    const placeholders = slice.map(() => "?").join(", ");
    await db.prepare(`DELETE FROM official_videos_latest WHERE account_key IN (${placeholders})`).bind(...slice).run();
  }
}

function uniqueAccountKeys(accountKeys = []) {
  return [...new Set((Array.isArray(accountKeys) ? accountKeys : []).map((key) => String(key || "").trim()).filter(Boolean))];
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
