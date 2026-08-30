import { summarizeOperationSignals } from "./private-tiktok-signals.js";

const DAY_MS = 86_400_000;

export function buildArchiveOperationSignals({
  accountRows = [],
  videosForAccount = () => [],
  accountNames = [],
  days = 10,
  videosPerAccount = 100,
  publishedAfter = 0,
  publishedBefore = 0,
  archiveDate = "",
  archiveAt = 0,
  now = Date.now,
} = {}) {
  const requested = new Set((accountNames || []).map(normalizeName).filter(Boolean));
  const safeDays = Math.max(1, Math.min(30, Math.floor(Number(days) || 10)));
  const safeVideos = Math.max(1, Math.min(100, Math.floor(Number(videosPerAccount) || 100)));
  const cutoffAt = Math.max(now() - safeDays * DAY_MS, Number(publishedAfter) || 0);
  const endAt = Number(publishedBefore) || 0;
  if (!accountRows.length) {
    return {
      connected: Boolean(archiveDate),
      status: "unavailable",
      error: archiveDate
        ? "官方归档还没有账号数据。"
        : "官方归档还没有写入。等主站同步完成后会自动落库。",
      archiveDate,
      archiveAt: Number(archiveAt) || 0,
      matchedAccountCount: 0,
      summary: { detailedVideoCount: 0 },
      accounts: [],
    };
  }

  const signals = [];
  for (const row of accountRows) {
    const profile = parseJson(row.profile_json, {});
    const username = normalizeName(profile.username || row.label);
    if (requested.size && !requested.has(username)) continue;
    const videos = (videosForAccount(row.account_key, safeVideos) || []).flatMap((video) => {
      const createdAt = toMillis(video.createTime || video.createdAt);
      if (createdAt && createdAt < cutoffAt) return [];
      if (endAt && createdAt && createdAt >= endAt) return [];
      return [{
        ...video,
        id: video.id || video.videoId,
        createdAt,
        caption: video.title || video.caption || "",
      }];
    });
    signals.push({
      schema: row.account_key,
      username,
      profile: {
        ...profile,
        username,
        displayName: profile.displayName || row.label || username,
      },
      videos,
    });
  }

  return {
    ...summarizeOperationSignals(signals, {
      days: safeDays,
      requestedAccountCount: requested.size,
      generatedAt: now(),
    }),
    archiveDate,
    archiveAt: Number(archiveAt) || 0,
  };
}

export function mapArchiveVideoRow(row = {}) {
  const raw = parseJson(row.video_json, row.video_json && typeof row.video_json === "object" ? row.video_json : {});
  const analytics = raw?.analytics && typeof raw.analytics === "object" ? raw.analytics : {};
  return {
    ...raw,
    id: String(row.video_id || raw.id || ""),
    account: String(row.account_key || raw.account || ""),
    createTime: Number(row.create_time || raw.createTime || 0),
    createdAt: toMillis(row.create_time || raw.createdAt || raw.createTime),
    title: String(row.title || raw.title || raw.caption || ""),
    caption: String(raw.caption || row.title || ""),
    views: Number(row.views ?? raw.views) || 0,
    likes: Number(row.likes ?? raw.likes) || 0,
    comments: Number(row.comments ?? raw.comments) || 0,
    shares: Number(row.shares ?? raw.shares) || 0,
    reach: Number(row.reach ?? raw.reach) || 0,
    duration: Number(raw.duration) || 0,
    averageTimeWatched: Number(raw.averageTimeWatched) || 0,
    fullWatchRate: Number(raw.fullWatchRate) || 0,
    retention: Array.isArray(raw.retention) ? raw.retention : [],
    analytics,
    syncedAt: Number(row.synced_at || raw.syncedAt) || 0,
  };
}

export function compactArchiveVideo(video = {}, accountKey = "") {
  return {
    id: String(video.id || video.videoId || ""),
    account: String(accountKey || video.account || ""),
    caption: String(video.caption || video.title || "").slice(0, 500),
    title: String(video.title || video.caption || "").slice(0, 500),
    createdAt: Number(video.createdAt || 0),
    createTime: Number(video.createTime || (Number(video.createdAt) > 1e12 ? Math.floor(Number(video.createdAt) / 1000) : Number(video.createdAt)) || 0),
    duration: Number(video.duration) || 0,
    views: Number(video.views || video.playCount) || 0,
    likes: Number(video.likes || video.diggCount) || 0,
    comments: Number(video.comments || video.commentCount) || 0,
    shares: Number(video.shares || video.shareCount) || 0,
    reach: Number(video.reach) || 0,
    averageTimeWatched: Number(video.averageTimeWatched) || 0,
    fullWatchRate: Number(video.fullWatchRate) || 0,
    totalTimeWatched: Number(video.totalTimeWatched) || 0,
    retention: Array.isArray(video.retention) ? video.retention.slice(0, 40) : [],
    impressionSources: Array.isArray(video.impressionSources) ? video.impressionSources.slice(0, 12) : [],
    analytics: video.analytics && typeof video.analytics === "object" ? video.analytics : {},
    syncedAt: Number(video.syncedAt || video.archiveFetchedAt) || 0,
  };
}

function normalizeName(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

function toMillis(value) {
  const number = Number(value) || 0;
  if (number <= 0) return 0;
  return number < 1e12 ? number * 1000 : number;
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
