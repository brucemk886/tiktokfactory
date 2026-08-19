import { compactArchiveVideo, mapArchiveVideoRow } from "./official-archive-signals.js";

export function accountVideoObjectKey(accountKey) {
  return `official-archive/videos/${encodeURIComponent(String(accountKey || ""))}.json`;
}

export function summarizeAccountVideos(videos = []) {
  const rows = Array.isArray(videos) ? videos : [];
  return {
    video_count: rows.length,
    views: sumField(rows, "views"),
    likes: sumField(rows, "likes"),
    comments: sumField(rows, "comments"),
    shares: sumField(rows, "shares"),
    reach: sumField(rows, "reach"),
  };
}

export function compactAccountVideos(accountKey, videos = []) {
  return (Array.isArray(videos) ? videos : [])
    .map((video) => compactArchiveVideo(video, accountKey))
    .filter((video) => video.id);
}

export function packAccountVideos(accountKey, videos = [], extra = {}) {
  const compact = compactAccountVideos(accountKey, videos);
  return {
    version: 1,
    account_key: String(accountKey || ""),
    snapshot_date: String(extra.snapshot_date || extra.snapshotDate || ""),
    synced_at: Number(extra.synced_at || extra.syncedAt || extra.latestSyncAt || 0),
    ...summarizeAccountVideos(compact),
    videos: compact,
  };
}

export function unpackAccountVideos(pack = {}, videosPerAccount = 100) {
  const safeVideos = Math.max(1, Math.min(100, Math.floor(Number(videosPerAccount) || 100)));
  const accountKey = String(pack.account_key || "");
  return (Array.isArray(pack.videos) ? pack.videos : [])
    .slice()
    .sort((left, right) => Number(right.createTime || right.createdAt || 0) - Number(left.createTime || left.createdAt || 0))
    .slice(0, safeVideos)
    .map((video) => mapArchiveVideoRow({
      video_id: video.id || video.videoId,
      account_key: accountKey,
      snapshot_date: pack.snapshot_date,
      synced_at: video.syncedAt || pack.synced_at,
      create_time: video.createTime || video.createdAt,
      title: video.title || video.caption || "",
      views: video.views,
      likes: video.likes,
      comments: video.comments,
      shares: video.shares,
      reach: video.reach,
      video_json: video,
    }));
}

export function buildAccountRow(account = {}, stamp = Date.now()) {
  const profile = account.profile && typeof account.profile === "object" ? account.profile : parseJson(account.profile_json, {});
  const accountKey = String(account.schema || account.account_key || account.accountKey || "");
  const videos = compactAccountVideos(accountKey, account.videos || []);
  const metrics = summarizeAccountVideos(videos);
  const snapshotDate = String(account.snapshotDate || account.snapshot_date || "");
  const syncedAt = Number(account.latestSyncAt || account.archiveFetchedAt || account.synced_at || stamp) || stamp;
  return {
    account_key: accountKey,
    snapshot_date: snapshotDate,
    synced_at: syncedAt,
    label: String(account.label || (profile.username ? `@${profile.username}` : accountKey)),
    profile_json: JSON.stringify(profile || {}),
    error: String(account.error || ""),
    ...metrics,
    videos,
  };
}

function sumField(rows, key) {
  return rows.reduce((total, item) => total + (Number(item?.[key]) || 0), 0);
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
