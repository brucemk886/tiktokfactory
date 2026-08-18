import { buildArchiveOperationSignals, compactArchiveVideo, mapArchiveVideoRow } from "../../scripts/official-archive-signals.js";
import { signalDesk } from "./signal-desk.js";

const BATCH_SIZE = 80;

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
  await writeArchiveRows(db, accounts);
  return readArchiveMeta(db);
}

export async function getOfficialOperationSignals(db, options = {}) {
  const meta = await readArchiveMeta(db);
  const accountRows = (await db.prepare("SELECT * FROM official_accounts_latest ORDER BY label COLLATE NOCASE").all()).results || [];
  const videosByAccount = new Map();
  const safeVideos = Math.max(1, Math.min(100, Math.floor(Number(options.videosPerAccount) || 100)));
  for (const row of accountRows) {
    const videos = (await db.prepare(
      "SELECT * FROM official_videos_latest WHERE account_key = ? ORDER BY create_time DESC, video_id LIMIT ?"
    ).bind(row.account_key, safeVideos).all()).results || [];
    videosByAccount.set(row.account_key, videos.map(mapArchiveVideoRow));
  }
  return buildArchiveOperationSignals({
    accountRows,
    videosForAccount: (accountKey) => videosByAccount.get(accountKey) || [],
    archiveDate: meta.archiveDate,
    archiveAt: meta.archiveAt,
    ...options,
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

async function writeArchiveRows(db, accounts) {
  const stamp = Date.now();
  let archiveDate = "";
  let archiveAt = 0;
  let videoCount = 0;
  const statements = [
    db.prepare("DELETE FROM official_videos_latest"),
    db.prepare("DELETE FROM official_accounts_latest"),
  ];
  for (const account of accounts) {
    const profile = account.profile || {};
    const accountKey = String(account.schema || "");
    if (!accountKey) continue;
    const snapshotDate = String(account.snapshotDate || "");
    const syncedAt = Number(account.latestSyncAt || account.archiveFetchedAt || stamp);
    archiveDate = snapshotDate > archiveDate ? snapshotDate : archiveDate;
    archiveAt = Math.max(archiveAt, syncedAt);
    statements.push(db.prepare(`
      INSERT INTO official_accounts_latest (account_key, snapshot_date, synced_at, label, profile_json, error)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      accountKey,
      snapshotDate,
      syncedAt,
      String(account.label || (profile.username ? `@${profile.username}` : accountKey)),
      JSON.stringify(profile),
      String(account.error || "")
    ));
    for (const raw of account.videos || []) {
      const video = compactArchiveVideo(raw, accountKey);
      if (!video.id) continue;
      videoCount += 1;
      const createTime = Number(video.createTime || (video.createdAt > 1e12 ? Math.floor(video.createdAt / 1000) : video.createdAt) || 0);
      statements.push(db.prepare(`
        INSERT INTO official_videos_latest
          (video_id, account_key, snapshot_date, synced_at, create_time, title, views, likes, comments, shares, reach, video_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        video.id,
        accountKey,
        snapshotDate,
        Number(video.syncedAt || syncedAt),
        createTime,
        video.title || video.caption || "",
        video.views,
        video.likes,
        video.comments,
        video.shares,
        video.reach,
        JSON.stringify(video)
      ));
    }
  }
  statements.push(db.prepare(`
    INSERT INTO official_archive_meta (id, archive_date, archive_at, account_count, video_count, updated_at, error)
    VALUES ('latest', ?, ?, ?, ?, ?, '')
    ON CONFLICT(id) DO UPDATE SET
      archive_date = excluded.archive_date,
      archive_at = excluded.archive_at,
      account_count = excluded.account_count,
      video_count = excluded.video_count,
      updated_at = excluded.updated_at,
      error = ''
  `).bind(archiveDate, archiveAt, accounts.length, videoCount, stamp));
  for (let index = 0; index < statements.length; index += BATCH_SIZE) {
    await db.batch(statements.slice(index, index + BATCH_SIZE));
  }
}
