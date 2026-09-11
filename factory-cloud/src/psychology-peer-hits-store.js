import { sha256Hex } from "./http.js";

const TABLE = "psychology_peer_hits";
const FIELDS = {
  videoId: "video_id", title: "title", accountName: "account_name", accountUsername: "account_username",
  accountUrl: "account_url", coverUrl: "cover_url", playCount: "play_count", likeCount: "like_count",
  commentCount: "comment_count", favoriteCount: "favorite_count", shareCount: "share_count",
  durationSeconds: "duration_seconds", publishedAt: "published_at", videoData: "video_data_json", source: "source"
};
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const optionalText = (value, limit, field) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > limit) fail(`${field} 必须是最多 ${limit} 字符的文本。`);
  return value.trim() || null;
};
function safeUrl(value, field) {
  const text = optionalText(value, 2000, field);
  if (!text) return null;
  let url; try { url = new URL(text); } catch { fail(`${field} 必须是完整网址。`); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) fail(`${field} 必须是无账号密码的 HTTP/HTTPS 网址。`);
  url.hash = "";
  return url;
}
function count(value, field) {
  if (value == null || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") fail(`${field} 必须是非负整数。`);
  const text = String(value).trim().replace(/,/g, "");
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([kmb万亿]?)$/i);
  if (!match) fail(`${field} 必须是非负整数，或 1.2K / 3.4万 这样的数量。`);
  const scale = { "": 1, k: 1000, m: 1e6, b: 1e9, "万": 1e4, "亿": 1e8 }[match[2].toLowerCase()];
  const result = Number(match[1]) * scale;
  if (!Number.isSafeInteger(result) || result < 0) fail(`${field} 数量无效或超出范围。`);
  return result;
}
function timestamp(value, field) {
  if (value == null || value === "") return null;
  let result;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    result = Number(value); if (result < 1e12) result *= 1000;
  } else {
    if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) fail(`${field} 请使用带时区的 ISO 时间或 Unix 时间戳。`);
    result = Date.parse(value);
  }
  if (!Number.isSafeInteger(result) || result <= 0 || result > Date.now() + 86400000) fail(`${field} 时间无效。`);
  return result;
}
export async function normalizePsychologyPeerHit(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("每条视频必须是 JSON 对象。");
  const url = safeUrl(raw.videoUrl, "videoUrl"); if (!url) fail("videoUrl 是必填字段。");
  const tiktok = /(^|\.)tiktok\.com$/i.test(url.hostname);
  const urlId = tiktok ? url.pathname.match(/\/video\/(\d+)(?:\/|$)/)?.[1] : null;
  const videoId = optionalText(raw.videoId, 100, "videoId") || urlId || null;
  if (raw.videoId && urlId && raw.videoId !== urlId) fail("videoId 与视频链接中的 ID 不一致。");
  const platform = tiktok ? "tiktok" : optionalText(raw.platform, 40, "platform")?.toLowerCase() || url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ["_t", "_r", "is_from_webapp", "sender_device", "share_app_id"].includes(key)) url.searchParams.delete(key);
  const videoUrl = url.toString();
  const videoKey = videoId ? `${platform}:${videoId}` : videoUrl.replace(/\/$/, "");
  const data = raw.videoData;
  if (data != null && (typeof data !== "object" || Array.isArray(data))) fail("videoData 必须是 JSON 对象。");
  if (data != null && JSON.stringify(data).length > 16000) fail("videoData 最多 16000 字符。");
  if (raw.durationSeconds != null && !["number", "string"].includes(typeof raw.durationSeconds)) fail("durationSeconds 必须是秒数。");
  const duration = raw.durationSeconds == null || raw.durationSeconds === "" ? null : Number(raw.durationSeconds);
  if (duration != null && (!Number.isFinite(duration) || duration < 0 || duration > 86400)) fail("durationSeconds 必须是 0–86400 秒。");
  return {
    id: "psy-" + (await sha256Hex(videoKey)).slice(0, 32), videoKey, videoUrl, platform, videoId,
    title: optionalText(raw.title, 2000, "title"), accountName: optionalText(raw.accountName, 160, "accountName"),
    accountUsername: optionalText(raw.accountUsername, 160, "accountUsername"),
    accountUrl: safeUrl(raw.accountUrl, "accountUrl")?.toString() || null,
    coverUrl: safeUrl(raw.coverUrl, "coverUrl")?.toString() || null,
    playCount: count(raw.playCount ?? raw.views, "playCount"), likeCount: count(raw.likeCount ?? raw.likes, "likeCount"),
    commentCount: count(raw.commentCount ?? raw.comments, "commentCount"),
    favoriteCount: count(raw.favoriteCount ?? raw.favorites ?? raw.saves, "favoriteCount"),
    shareCount: count(raw.shareCount ?? raw.shares, "shareCount"), durationSeconds: duration,
    publishedAt: timestamp(raw.publishedAt, "publishedAt"), collectedAt: timestamp(raw.collectedAt, "collectedAt") || now,
    videoData: data || null, source: optionalText(raw.source, 80, "source")
  };
}
export function psychologyPeerHitFromRow(row) {
  if (!row) return null;
  const item = { id: row.id, videoUrl: row.video_url, platform: row.platform, collectedAt: row.collected_at, createdAt: row.created_at, updatedAt: row.updated_at };
  for (const [key, column] of Object.entries(FIELDS)) item[key] = key === "videoData" ? JSON.parse(row[column] || "{}") : row[column] ?? null;
  return item;
}
export async function importPsychologyPeerHits(db, payload, actor) {
  const rawItems = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [payload];
  if (!rawItems.length || rawItems.length > 100) fail("每次提交 1–100 条视频。");
  const now = Date.now();
  const items = await Promise.all(rawItems.map(async (raw, index) => {
    try { return await normalizePsychologyPeerHit(raw, now); } catch (error) { error.message = `第 ${index + 1} 条：${error.message}`; throw error; }
  }));
  const columns = Object.values(FIELDS);
  const statements = items.map(item => db.prepare(`
    INSERT INTO ${TABLE} (id, video_key, video_url, platform, ${columns.join(",")}, collected_at, created_by, created_at, updated_at)
    VALUES (${Array(4 + columns.length + 4).fill("?").join(",")})
    ON CONFLICT(video_key) DO UPDATE SET
      video_url = excluded.video_url,
      ${columns.map(column => column === "video_data_json" ? `${column} = CASE WHEN excluded.${column} IS NULL THEN ${TABLE}.${column} ELSE json_patch(COALESCE(${TABLE}.${column}, '{}'), excluded.${column}) END` : `${column} = COALESCE(excluded.${column}, ${TABLE}.${column})`).join(",")},
      collected_at = excluded.collected_at, updated_at = excluded.updated_at
    WHERE excluded.collected_at >= ${TABLE}.collected_at
    RETURNING id, video_url, collected_at
  `).bind(item.id, item.videoKey, item.videoUrl, item.platform,
    ...Object.keys(FIELDS).map(key => key === "videoData" && item[key] !== null ? JSON.stringify(item[key]) : item[key]),
    item.collectedAt, actor, now, now));
  const results = await db.batch(statements);
  return { accepted: results.filter(result => result.results?.length).length, ignoredOlder: results.filter(result => !result.results?.length).length,
    items: items.map((item, i) => ({ id: item.id, videoUrl: item.videoUrl, status: results[i].results?.length ? "saved" : "ignored_older" })) };
}
export async function listPsychologyPeerHits(db, params) {
  const requested = Number(params.get("page") || 1);
  if (!Number.isSafeInteger(requested) || requested < 1) fail("页码无效。");
  const query = String(params.get("query") || "").trim().slice(0, 200);
  const sort = params.get("sort") || "plays";
  const sorts = { plays: "play_count", collected: "collected_at", published: "published_at" };
  if (!Object.hasOwn(sorts, sort)) fail("排序方式无效。");
  const filter = query ? " WHERE title LIKE ? OR account_name LIKE ? OR account_username LIKE ? OR video_url LIKE ?" : "";
  const binds = query ? Array(4).fill("%" + query + "%") : [];
  const total = Number((await db.prepare(`SELECT COUNT(*) AS total FROM ${TABLE}${filter}`).bind(...binds).first())?.total || 0);
  const pageSize = 20, totalPages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(requested, totalPages);
  const rows = await db.prepare(`SELECT * FROM ${TABLE}${filter} ORDER BY ${sorts[sort]} DESC, id DESC LIMIT ? OFFSET ?`).bind(...binds, pageSize, (page - 1) * pageSize).all();
  return { items: (rows.results || []).map(psychologyPeerHitFromRow), total, page, pageSize, totalPages };
}
