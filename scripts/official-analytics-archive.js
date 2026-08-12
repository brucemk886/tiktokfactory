import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DAY_MS = 86_400_000;
const DEFAULT_SYNC_HOUR = 8;
const DEFAULT_SYNC_MINUTE = 30;
const DATABASE_NAME = "official-history.sqlite";

export function createOfficialAnalyticsArchive({
  workDir,
  service,
  now = () => Date.now(),
  syncHour = DEFAULT_SYNC_HOUR,
  syncMinute = DEFAULT_SYNC_MINUTE,
  requestIntervalMs = 650,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  logger = console,
} = {}) {
  if (!workDir || !service) throw new Error("Official analytics archive is not configured.");
  const archiveDir = path.join(workDir, "official-tiktok-history");
  const databasePath = path.join(archiveDir, DATABASE_NAME);
  fs.mkdirSync(archiveDir, { recursive: true });
  const database = openDatabase(databasePath);
  migrateLegacyJsonFiles(database, archiveDir, logger);
  let timer = null;
  let running = null;
  let lastRequestAt = 0;

  async function callBridge(callback) {
    const interval = Math.max(0, Number(requestIntervalMs) || 0);
    const waitMs = Math.max(0, lastRequestAt + interval - now());
    if (waitMs) await sleep(waitMs);
    lastRequestAt = now();
    return callback();
  }

  async function run({ ignoreDailyGuard = false } = {}) {
    if (running) return running;
    running = execute(ignoreDailyGuard).finally(() => { running = null; });
    return running;
  }

  async function execute(ignoreDailyGuard) {
    const startedAt = now();
    const dateKey = beijingDateKey(startedAt);
    const previousRun = getRun(database, dateKey);
    const checkpoint = getSyncCheckpoint(database, dateKey);
    if (!ignoreDailyGuard && previousRun && checkpoint?.status === "completed") {
      return { skipped: true, reason: "already_archived_today", ...runResult(previousRun, archiveDir, databasePath) };
    }

    let cursor = checkpoint?.status === "running" ? String(checkpoint.cursor || "") : "";
    let accountCount = checkpoint?.status === "running" ? number(checkpoint.account_count) : 0;
    let videoCount = checkpoint?.status === "running" ? number(checkpoint.video_count) : 0;
    const errors = [];
    writeSyncCheckpoint(database, { dateKey, cursor, accountCount, videoCount, status: "running", updatedAt: startedAt });
    let pageCount = 0;
    while (accountCount < 10_000) {
      const page = await callBridge(() => service.listArchivePage({ cursor, limit: 20, videosPerAccount: 100 }));
      const pageAccounts = (Array.isArray(page?.accounts) ? page.accounts : []).map((account) => ({
        ...account,
        label: String(account?.label || account?.profile?.username || account?.schema || ""),
        profile: account?.profile || {},
        videos: Array.isArray(account?.videos) ? account.videos : [],
        syncedAt: number(account?.archiveFetchedAt) || now(),
        error: account?.archiveAvailable === false && !(account?.videos || []).length ? "analytics_archive_not_available" : "",
      }));
      if (!pageAccounts.length && !page?.hasMore) break;
      const pageErrors = pageAccounts.filter((account) => account.error).map((account) => ({ schema: account.schema, error: account.error }));
      errors.push(...pageErrors);
      accountCount += pageAccounts.length;
      videoCount += pageAccounts.reduce((sum, account) => sum + account.videos.length, 0);
      writeArchiveRun(database, {
        version: 3, dateKey, startedAt, completedAt: now(), accountCount, videoCount,
        accounts: pageAccounts, errors,
      }, { replaceVideosForDate: true });
      const nextCursor = String(page?.nextCursor || "");
      pageCount += 1;
      writeSyncCheckpoint(database, { dateKey, cursor: nextCursor, accountCount, videoCount, status: page?.hasMore ? "running" : "completed", updatedAt: now() });
      if (!page?.hasMore || !nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    const completedAt = now();
    writeArchiveRun(database, {
      version: 3,
      dateKey,
      startedAt,
      completedAt,
      accountCount,
      videoCount,
      accounts: [],
      errors,
    });
    writeSyncCheckpoint(database, { dateKey, cursor, accountCount, videoCount, status: "completed", updatedAt: completedAt });
    return {
      dateKey,
      accountCount,
      videoCount,
      errorCount: errors.length,
      pageCount,
      completedAt,
      archiveDir,
      databasePath,
    };
  }

  function getDashboard({ days = 30, account = "", video = "", search = "" } = {}) {
    const safeDays = days === "all" ? "all" : Math.max(1, Math.min(3650, Math.floor(Number(days) || 30)));
    return buildDashboardFromDatabase(database, { days: safeDays, account, video, search, state: getStatus(), archiveDir, databasePath });
  }

  function start() {
    scheduleNext();
    return getStatus();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function close() {
    stop();
    database.close();
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer);
    const current = now();
    const lastRun = getLatestRun(database);
    const todayTarget = beijingTimeForDate(current, syncHour, syncMinute);
    const todayKey = beijingDateKey(current);
    const todayCheckpoint = getSyncCheckpoint(database, todayKey);
    const shouldCatchUp = current >= todayTarget
      && (lastRun?.date_key !== todayKey || todayCheckpoint?.status !== "completed");
    const target = shouldCatchUp ? current + 15_000 : nextBeijingRun(current, syncHour, syncMinute);
    timer = setTimeout(async () => {
      try { await run(); } catch (error) { logger.error("Official analytics archive failed:", error); }
      scheduleNext();
    }, Math.max(1_000, target - current));
    timer.unref?.();
  }

  function getStatus() {
    const lastRun = getLatestRun(database);
    return {
      running: Boolean(running),
      syncHour,
      syncMinute,
      archiveDir,
      databasePath,
      lastRunDate: lastRun?.date_key || "",
      lastRunAt: number(lastRun?.started_at),
      lastResult: lastRun ? runResult(lastRun, archiveDir, databasePath) : null,
    };
  }

  return { run, start, stop, close, getStatus, getDashboard };
}

function openDatabase(databasePath) {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
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
  return database;
}

function writeArchiveRun(database, snapshot, { source = "sqlite", replaceVideosForDate = true } = {}) {
  const insertRun = database.prepare(`INSERT INTO archive_runs
    (date_key, started_at, completed_at, account_count, video_count, error_count, errors_json, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date_key) DO UPDATE SET started_at=excluded.started_at, completed_at=excluded.completed_at,
      account_count=excluded.account_count, video_count=excluded.video_count, error_count=excluded.error_count,
      errors_json=excluded.errors_json, source=excluded.source`);
  const upsertAccountDaily = database.prepare(`INSERT INTO account_daily_snapshots
    (account_key, snapshot_date, synced_at, label, followers, following, total_likes, reported_videos, profile_json, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_key, snapshot_date) DO UPDATE SET synced_at=excluded.synced_at, label=excluded.label,
      followers=excluded.followers, following=excluded.following, total_likes=excluded.total_likes,
      reported_videos=excluded.reported_videos, profile_json=excluded.profile_json, error=excluded.error`);
  const upsertAccountLatest = database.prepare(`INSERT INTO accounts_latest
    (account_key, snapshot_date, synced_at, label, followers, following, total_likes, reported_videos, profile_json, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_key) DO UPDATE SET snapshot_date=excluded.snapshot_date, synced_at=excluded.synced_at,
      label=excluded.label, followers=excluded.followers, following=excluded.following,
      total_likes=excluded.total_likes, reported_videos=excluded.reported_videos,
      profile_json=excluded.profile_json, error=excluded.error
    WHERE excluded.snapshot_date >= accounts_latest.snapshot_date`);
  const deleteDailyVideos = database.prepare("DELETE FROM video_daily_snapshots WHERE account_key = ? AND snapshot_date = ?");
  const upsertVideoDaily = database.prepare(`INSERT INTO video_daily_snapshots
    (video_id, account_key, snapshot_date, synced_at, create_time, title, views, likes, comments, shares, reach, video_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id, account_key, snapshot_date) DO UPDATE SET synced_at=excluded.synced_at,
      create_time=excluded.create_time, title=excluded.title, views=excluded.views, likes=excluded.likes,
      comments=excluded.comments, shares=excluded.shares, reach=excluded.reach, video_json=excluded.video_json`);
  const upsertVideoLatest = database.prepare(`INSERT INTO videos_latest
    (video_id, account_key, snapshot_date, synced_at, create_time, title, views, likes, comments, shares, reach, video_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id, account_key) DO UPDATE SET snapshot_date=excluded.snapshot_date,
      synced_at=excluded.synced_at, create_time=excluded.create_time, title=excluded.title, views=excluded.views,
      likes=excluded.likes, comments=excluded.comments, shares=excluded.shares, reach=excluded.reach,
      video_json=excluded.video_json WHERE excluded.snapshot_date >= videos_latest.snapshot_date`);

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const account of snapshot.accounts || []) {
      const profile = account?.profile || {};
      const accountValues = [
        String(account?.schema || ""), String(snapshot.dateKey), number(account?.syncedAt || snapshot.completedAt),
        String(account?.label || profile?.username || account?.schema || ""), number(profile?.followers),
        number(profile?.following), number(profile?.totalLikes), number(profile?.videos), JSON.stringify(profile),
        String(account?.error || ""),
      ];
      upsertAccountDaily.run(...accountValues);
      upsertAccountLatest.run(...accountValues);
      if (!account?.error && replaceVideosForDate) deleteDailyVideos.run(String(account?.schema || ""), String(snapshot.dateKey));
      if (account?.error) continue;
      for (const video of account?.videos || []) {
        const videoId = String(video?.id || video?.videoId || "").trim();
        if (!videoId) continue;
        const videoValues = videoDbValues(video, account.schema, snapshot.dateKey, account.syncedAt || snapshot.completedAt);
        upsertVideoDaily.run(...videoValues);
        upsertVideoLatest.run(...videoValues);
      }
    }
    insertRun.run(String(snapshot.dateKey), number(snapshot.startedAt), number(snapshot.completedAt),
      number(snapshot.accountCount), number(snapshot.videoCount), (snapshot.errors || []).length,
      JSON.stringify(snapshot.errors || []), source);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function videoDbValues(video, accountKey, dateKey, syncedAt) {
  return [
    String(video?.id || video?.videoId || ""), String(accountKey || ""), String(dateKey), number(syncedAt),
    number(video?.createTime || video?.create_time || video?.publishedAt),
    String(video?.title || video?.caption || video?.description || ""), number(video?.views), number(video?.likes),
    number(video?.comments), number(video?.shares), number(video?.reach), JSON.stringify(video || {}),
  ];
}

function buildDashboardFromDatabase(database, { days, account, video, search, state, archiveDir, databasePath }) {
  const dateRows = days === "all"
    ? database.prepare("SELECT date_key FROM archive_runs ORDER BY date_key").all()
    : database.prepare("SELECT date_key FROM (SELECT date_key FROM archive_runs ORDER BY date_key DESC LIMIT ?) ORDER BY date_key").all(days);
  const dateKeys = dateRows.map((row) => String(row.date_key));
  const oldestDate = dateKeys[0] || "";
  const latestDate = dateKeys.at(-1) || "";
  const query = `%${String(search || "").trim().toLowerCase()}%`;
  const accountRows = database.prepare(`SELECT a.*,
      COUNT(v.video_id) AS video_count, COALESCE(SUM(v.views),0) AS views, COALESCE(SUM(v.likes),0) AS likes,
      COALESCE(SUM(v.comments),0) AS comments, COALESCE(SUM(v.shares),0) AS shares, COALESCE(SUM(v.reach),0) AS reach
    FROM accounts_latest a LEFT JOIN videos_latest v ON v.account_key = a.account_key
    WHERE ? = '%%' OR lower(a.account_key || ' ' || a.label || ' ' || a.profile_json) LIKE ?
    GROUP BY a.account_key ORDER BY a.label COLLATE NOCASE`).all(query, query).map(accountRow);
  const selectedAccount = String(account || accountRows[0]?.schema || "").trim();
  const accountHistorySql = `SELECT a.*,
      COUNT(v.video_id) AS video_count, COALESCE(SUM(v.views),0) AS views, COALESCE(SUM(v.likes),0) AS likes,
      COALESCE(SUM(v.comments),0) AS comments, COALESCE(SUM(v.shares),0) AS shares, COALESCE(SUM(v.reach),0) AS reach
    FROM account_daily_snapshots a LEFT JOIN video_daily_snapshots v
      ON v.account_key = a.account_key AND v.snapshot_date = a.snapshot_date
    WHERE a.account_key = ? ${oldestDate ? "AND a.snapshot_date >= ?" : ""}
    GROUP BY a.account_key, a.snapshot_date ORDER BY a.snapshot_date`;
  const accountHistoryRows = oldestDate
    ? database.prepare(accountHistorySql).all(selectedAccount, oldestDate)
    : database.prepare(accountHistorySql).all(selectedAccount);
  const accountHistory = accountHistoryRows.map((row) => ({ dateKey: row.snapshot_date, ...accountRow(row) }));
  const videoRows = database.prepare("SELECT * FROM videos_latest WHERE account_key = ? ORDER BY create_time DESC, video_id LIMIT 100").all(selectedAccount).map(videoRow);
  const activeVideo = String(video || videoRows[0]?.id || "").trim();
  const videoHistoryRows = oldestDate
    ? database.prepare("SELECT * FROM video_daily_snapshots WHERE account_key = ? AND video_id = ? AND snapshot_date >= ? ORDER BY snapshot_date").all(selectedAccount, activeVideo, oldestDate)
    : database.prepare("SELECT * FROM video_daily_snapshots WHERE account_key = ? AND video_id = ? ORDER BY snapshot_date").all(selectedAccount, activeVideo);
  const videoHistory = videoHistoryRows.map((row) => ({ dateKey: row.snapshot_date, ...videoRow(row) }));
  const overview = accountRows.reduce((sum, item) => ({
    accounts: sum.accounts + 1, videos: sum.videos + item.videoCount, followers: sum.followers + item.followers,
    views: sum.views + item.views, likes: sum.likes + item.likes, comments: sum.comments + item.comments,
    shares: sum.shares + item.shares, reach: sum.reach + item.reach,
  }), { accounts: 0, videos: 0, followers: 0, views: 0, likes: 0, comments: 0, shares: 0, reach: 0 });
  return { connected: true, archiveDir, databasePath, state, dateKeys, latestDate, overview, accounts: accountRows, selectedAccount, accountHistory, videos: videoRows, selectedVideo: activeVideo, videoHistory };
}

function accountRow(row) {
  const profile = parseJson(row.profile_json, {});
  return {
    schema: String(row.account_key || ""), label: String(row.label || profile?.username || row.account_key || ""),
    profileImage: String(profile?.profileImage || ""), followers: number(row.followers), following: number(row.following),
    totalLikes: number(row.total_likes), reportedVideos: number(row.reported_videos), videoCount: number(row.video_count),
    views: number(row.views), likes: number(row.likes), comments: number(row.comments), shares: number(row.shares),
    reach: number(row.reach), syncedAt: number(row.synced_at), error: String(row.error || ""),
  };
}

function videoRow(row) {
  return {
    ...parseJson(row.video_json, {}), id: String(row.video_id || ""), account: String(row.account_key || ""),
    createTime: number(row.create_time), title: String(row.title || ""), views: number(row.views), likes: number(row.likes),
    comments: number(row.comments), shares: number(row.shares), reach: number(row.reach), syncedAt: number(row.synced_at),
  };
}

function migrateLegacyJsonFiles(database, archiveDir, logger) {
  const names = fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
    .map((entry) => entry.name).sort();
  const hasRun = database.prepare("SELECT 1 AS found FROM archive_runs WHERE date_key = ?");
  for (const name of names) {
    const dateKey = name.slice(0, 10);
    if (hasRun.get(dateKey)) continue;
    try {
      const snapshot = parseJson(fs.readFileSync(path.join(archiveDir, name), "utf8"), null);
      if (!snapshot?.dateKey || !Array.isArray(snapshot?.accounts)) continue;
      writeArchiveRun(database, snapshot, { source: "legacy_json" });
    } catch (error) {
      logger.warn?.(`Could not import legacy official archive ${name}:`, error);
    }
  }
}

function getRun(database, dateKey) { return database.prepare("SELECT * FROM archive_runs WHERE date_key = ?").get(String(dateKey)); }
function getLatestRun(database) { return database.prepare("SELECT * FROM archive_runs ORDER BY date_key DESC LIMIT 1").get(); }
function getLatestAccount(database, accountKey) {
  const row = database.prepare("SELECT label, profile_json FROM accounts_latest WHERE account_key = ?").get(String(accountKey));
  return row ? { label: String(row.label || ""), profile: parseJson(row.profile_json, {}) } : null;
}

function getSyncCheckpoint(database, dateKey) {
  return database.prepare("SELECT * FROM archive_sync_checkpoints WHERE date_key = ?").get(String(dateKey));
}

function writeSyncCheckpoint(database, value) {
  database.prepare(`INSERT INTO archive_sync_checkpoints
    (date_key, cursor, account_count, video_count, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date_key) DO UPDATE SET cursor=excluded.cursor, account_count=excluded.account_count,
      video_count=excluded.video_count, status=excluded.status, updated_at=excluded.updated_at`)
    .run(String(value.dateKey), String(value.cursor || ""), number(value.accountCount), number(value.videoCount), String(value.status || "running"), number(value.updatedAt));
}
function runResult(row, archiveDir, databasePath) {
  return { dateKey: row.date_key, accountCount: number(row.account_count), videoCount: number(row.video_count), errorCount: number(row.error_count), completedAt: number(row.completed_at), archiveDir, databasePath };
}
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function cleanError(error) { return String(error?.message || error || "Unknown error").slice(0, 500); }
function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function beijingDateKey(timestamp) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp)); }
function beijingTimeForDate(timestamp, hour, minute = 0) { return Date.parse(`${beijingDateKey(timestamp)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`); }
function nextBeijingRun(timestamp, hour, minute = 0) { const today = beijingTimeForDate(timestamp, hour, minute); return timestamp < today ? today : today + DAY_MS; }
export function nextOfficialArchiveRun(timestamp, hour, minute = 0) { return nextBeijingRun(timestamp, hour, minute); }
