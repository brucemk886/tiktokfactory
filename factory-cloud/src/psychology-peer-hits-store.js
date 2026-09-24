import { sha256Hex } from "./http.js";
import { isEnglishPsychologyPeerHit } from "../../scripts/psychology-peer-language.js";
import { photoCopyKey } from "./peer-photo-copy-cache.js";
import { importedCopy } from "./psychology-copy-library.js";
import { normalizeVariant } from "./psychology-creative.js";
import { checkRewrite, checkSharedLines } from "./psychology-rewrite-quality.js";
import { parseTopics } from "../../scripts/psychology-peer-topics.js";

const TABLE = "psychology_peer_hits";
const COPY_SYNC = `INSERT INTO psychology_copy_library(id,owner,media_type,title,source_url,source_json,created_at,updated_at)
  SELECT p.id,COALESCE((SELECT username FROM factory_users WHERE id=p.created_by),p.created_by),p.media_type,COALESCE(p.title,''),p.video_url,
    json_object('id',p.id,'videoUrl',p.video_url,'title',COALESCE(p.title,''),'mediaType',p.media_type,'platform',p.platform,'videoData',json(COALESCE(p.video_data_json,'{}')),'durationSeconds',p.duration_seconds),p.created_at,p.updated_at
  FROM psychology_peer_hits p WHERE p.id=? AND p.collected_at=?
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,source_url=excluded.source_url,source_json=excluded.source_json,
    status=CASE WHEN psychology_copy_library.media_type<>excluded.media_type THEN 'queued' ELSE psychology_copy_library.status END,
    attempt=psychology_copy_library.attempt+CASE WHEN psychology_copy_library.media_type<>excluded.media_type THEN 1 ELSE 0 END,
    content_json=CASE WHEN psychology_copy_library.media_type<>excluded.media_type THEN '{}' ELSE psychology_copy_library.content_json END,
    error=CASE WHEN psychology_copy_library.media_type<>excluded.media_type THEN '' ELSE psychology_copy_library.error END,
    workflow_id=CASE WHEN psychology_copy_library.media_type<>excluded.media_type THEN '' ELSE psychology_copy_library.workflow_id END,
    completed_at=CASE WHEN psychology_copy_library.media_type<>excluded.media_type THEN 0 ELSE psychology_copy_library.completed_at END,
    media_type=excluded.media_type,updated_at=excluded.updated_at`;
const COPY_SYNC_BY_ID=COPY_SYNC.replace('p.id=? AND p.collected_at=?','p.id=?');
// Text grokbot already read completes the copy on the spot, historical rows
// included. Bumping attempt stops any extraction still running from
// overwriting it; finished copy is never replaced.
const COPY_SUPPLIED = `UPDATE psychology_copy_library SET status='done',content_json=?,provider='imported-text',error='',
  attempt=attempt+1,workflow_id='',completed_at=?,updated_at=?
  WHERE id=? AND status<>'done' AND media_type=? AND EXISTS (SELECT 1 FROM psychology_peer_hits WHERE id=? AND collected_at=?)`;
// Supplied text with no usable page ends the copy without a paid extraction.
const COPY_SKIPPED = `UPDATE psychology_copy_library SET status='failed',error=?,attempt=attempt+1,workflow_id='',updated_at=?
  WHERE id=? AND status<>'done' AND media_type=? AND EXISTS (SELECT 1 FROM psychology_peer_hits WHERE id=? AND collected_at=?)`;
// One statement for every rewrite in the request keeps a 100-post batch far
// below D1's per-invocation query limit.
const REWRITE_INSERT = `INSERT INTO psychology_copy_variants(id,owner,external_id,source_key,title,caption,pages_json,fingerprint,created_at,quality_score,score_reason,comparison_json)
  SELECT json_extract(value,'$.id'),json_extract(value,'$.owner'),json_extract(value,'$.externalId'),json_extract(value,'$.sourceKey'),
    json_extract(value,'$.title'),json_extract(value,'$.caption'),json_extract(value,'$.pagesJson'),json_extract(value,'$.fingerprint'),?,json_extract(value,'$.score'),json_extract(value,'$.scoreReason'),json_extract(value,'$.comparisonJson')
  FROM json_each(?) WHERE true ON CONFLICT(id) DO UPDATE SET
 quality_score=COALESCE(excluded.quality_score,psychology_copy_variants.quality_score),
 score_reason=CASE WHEN excluded.score_reason<>'' THEN excluded.score_reason ELSE psychology_copy_variants.score_reason END,
 comparison_json=CASE WHEN excluded.comparison_json<>'' THEN excluded.comparison_json ELSE psychology_copy_variants.comparison_json END
 WHERE psychology_copy_variants.fingerprint=excluded.fingerprint AND psychology_copy_variants.deleted_at=0`;
const MAX_REWRITES_PER_ITEM = 10;
const MAX_REWRITES_PER_REQUEST = 500;
// Must match librarySource so rewrites land under the same original.
export function copySourceKey(item) {
  try { return photoCopyKey(item.videoUrl); } catch { return item.id; }
}
async function normalizeRewrites(raw, item) {
  if (raw.rewrites == null) return [];
  if (!Array.isArray(raw.rewrites) || raw.rewrites.length > MAX_REWRITES_PER_ITEM) fail(`rewrites 须为最多 ${MAX_REWRITES_PER_ITEM} 个改写版本的数组。`);
  const sourceKey = copySourceKey(item);
  return Promise.all(raw.rewrites.map(async (rewrite, index) => {
    if (!rewrite || typeof rewrite !== "object" || Array.isArray(rewrite)) fail(`rewrites 第 ${index + 1} 项必须是对象。`);
    const provided = typeof rewrite.externalId === "string" ? rewrite.externalId.trim() : "";
    let variant;
    const pageTexts = Array.isArray(item.videoData?.pageTexts) ? item.videoData.pageTexts.filter(text => typeof text === "string") : [];
    try { variant = normalizeVariant({ ...rewrite, sourceKey, externalId: provided || "derived" }); checkRewrite(variant, pageTexts); }
    catch (error) { error.message = `rewrites 第 ${index + 1} 项：${error.message}`; throw error; }
    const fingerprint = await sha256Hex(JSON.stringify([variant.sourceKey, variant.title, variant.caption, variant.pages]));
    // An omitted ID follows the content, so resending identical rewrites is a no-op.
    variant.externalId = provided || "grok-" + fingerprint.slice(0, 32);
    return { ...variant, fingerprint };
  }));
}
const FIELDS = {
  mediaType: "media_type", voiceGender: "voice_gender", videoId: "video_id", title: "title", accountName: "account_name", accountUsername: "account_username",
  accountUrl: "account_url", coverUrl: "cover_url", playCount: "play_count", likeCount: "like_count",
  commentCount: "comment_count", favoriteCount: "favorite_count", shareCount: "share_count",
  durationSeconds: "duration_seconds", publishedAt: "published_at", videoData: "video_data_json", source: "source",
  topics: "topics_json", topComments: "comments_json"
};
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
export function normalizeVoiceGender(value, fallback = "male") {
  if (value == null || value === "") return fallback;
  const gender = String(value).trim().toLowerCase();
  if (!["male", "female"].includes(gender)) fail("voiceGender 只能是 male 或 female。");
  return gender;
}
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
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("每条内容必须是 JSON 对象。");
  const url = safeUrl(raw.videoUrl, "videoUrl"); if (!url) fail("videoUrl 是必填字段。");
  const tiktok = /(^|\.)tiktok\.com$/i.test(url.hostname);
  const urlType = tiktok ? url.pathname.match(/\/(video|photo)\/(\d+)(?:\/|$)/) : null;
  const urlId = urlType?.[2] || null;
  const videoId = optionalText(raw.videoId, 100, "videoId") || urlId || null;
  if (raw.videoId && urlId && String(raw.videoId) !== urlId) fail("videoId 与内容链接中的 ID 不一致。");
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
  const rawMediaType = String(raw.mediaType || raw.postType || data?.mediaType || data?.postType || urlType?.[1] || "video").trim().toLowerCase();
  const mediaType = rawMediaType === "image" || rawMediaType === "carousel" ? "photo" : rawMediaType;
  if (!["video", "photo"].includes(mediaType)) fail("mediaType 只能是 video 或 photo。");
  if (urlType?.[1] && urlType[1] !== mediaType) fail("mediaType 与 TikTok 链接类型不一致。");
  const voiceGenderProvided = raw.voiceGender != null && raw.voiceGender !== "";
  const voiceGender = normalizeVoiceGender(raw.voiceGender);
  return {
    id: "psy-" + (await sha256Hex(videoKey)).slice(0, 32), videoKey, videoUrl, platform, mediaType, voiceGender, voiceGenderProvided, videoId,
    title: optionalText(raw.title, 2000, "title"), accountName: optionalText(raw.accountName, 160, "accountName"),
    accountUsername: optionalText(raw.accountUsername, 160, "accountUsername"),
    accountUrl: safeUrl(raw.accountUrl, "accountUrl")?.toString() || null,
    coverUrl: safeUrl(raw.coverUrl, "coverUrl")?.toString() || null,
    playCount: count(raw.playCount ?? raw.views, "playCount"), likeCount: count(raw.likeCount ?? raw.likes, "likeCount"),
    commentCount: count(raw.commentCount ?? raw.comments, "commentCount"),
    favoriteCount: count(raw.favoriteCount ?? raw.favorites ?? raw.saves, "favoriteCount"),
    shareCount: count(raw.shareCount ?? raw.shares, "shareCount"), durationSeconds: duration,
    publishedAt: timestamp(raw.publishedAt, "publishedAt"), collectedAt: timestamp(raw.collectedAt, "collectedAt") || now,
    videoData: data || null, source: optionalText(raw.source, 80, "source"),
    topics: topicsOf(raw.topics ?? data?.topics), topComments: parseComments(raw.topComments ?? data?.topComments)
  };
}
function topicsOf(value) { try { return parseTopics(value); } catch (error) { fail(error.message); } }
function parseComments(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 20) fail("topComments 最多 20 条。");
  return value.map((item, index) => {
    const text = typeof item === "string" ? item : item?.text;
    if (typeof text !== "string" || !text.trim() || text.trim().length > 300) fail(`topComments 第 ${index + 1} 条须为最多 300 字符的评论原文。`);
    const likes = item && typeof item === "object" ? count(item.likes ?? item.likeCount, "topComments.likes") : 0;
    return { text: text.trim(), likes: likes || 0 };
  }).sort((a, b) => b.likes - a.likes);
}
export function psychologyPeerHitFromRow(row) {
  if (!row) return null;
  const item = { id: row.id, videoUrl: row.video_url, platform: row.platform, collectedAt: row.collected_at, createdAt: row.created_at, updatedAt: row.updated_at };
  for (const [key, column] of Object.entries(FIELDS)) item[key] = ["videoData", "topics", "topComments"].includes(key) ? JSON.parse(row[column] || (key === "videoData" ? "{}" : "[]")) : row[column] ?? null;
  return item;
}
// Grokbot must send the post's metrics, publish time and account (operator
// rule, 2026-09-24). An update may omit a field the saved row already has.
const REQUIRED_METRICS = [["playCount", "play_count"], ["likeCount", "like_count"], ["commentCount", "comment_count"],
  ["favoriteCount", "favorite_count"], ["shareCount", "share_count"], ["publishedAt", "published_at"]];
async function assertRequiredMetrics(db, items) {
  const saved = new Map((await db.prepare(`SELECT id,${REQUIRED_METRICS.map(([, c]) => c).join(",")},account_name,account_username,topics_json,comments_json FROM ${TABLE} WHERE id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(items.map(item => item.id))).all()).results.map(row => [row.id, row]));
  items.forEach((item, index) => {
    const row = saved.get(item.id) || {};
    const missing = REQUIRED_METRICS.filter(([field, column]) => item[field] == null && row[column] == null).map(([field]) => field);
    if (!item.accountUsername && !item.accountName && !row.account_username && !row.account_name) missing.push("accountUsername");
    if (missing.length) fail(`第 ${index + 1} 条缺少必填字段：${missing.join("、")}。播放、点赞、评论、收藏、分享、原帖发布时间和账号都必须提供（没有的数量填 0）。`);
    const savedTopics = row.topics_json && row.topics_json !== "[]" ? JSON.parse(row.topics_json) : null;
    const savedComments = row.comments_json ? JSON.parse(row.comments_json) : null;
    const topics = item.topics || savedTopics;
    const comments = item.topComments != null ? item.topComments : savedComments;
    const commentCount = item.commentCount ?? row.comment_count;
    const enrich = [];
    if (!topics?.length) enrich.push("topics");
    if (comments == null || (Number(commentCount) > 0 && !comments.length)) enrich.push("topComments");
    if (enrich.length) fail(`第 ${index + 1} 条缺少必填字段：${enrich.join("、")}。题材标签 topics 填 1–3 个；评论数大于 0 时 topComments 至少 1 条、最多 20 条（按点赞从高到低），评论数为 0 时传空数组。`);
  });
}
export async function importPsychologyPeerHits(db, payload, actor, { requireMetrics = false } = {}) {
  const rawItems = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [payload];
  if (!rawItems.length || rawItems.length > 100) fail("每次提交 1–100 条内容。");
  const now = Date.now();
  const items = await Promise.all(rawItems.map(async (raw, index) => {
    try {
      const item = await normalizePsychologyPeerHit(raw, now);
      item.rewrites = await normalizeRewrites(raw, item);
      return item;
    } catch (error) { error.message = `第 ${index + 1} 条：${error.message}`; throw error; }
  }));
  if (items.reduce((sum, item) => sum + item.rewrites.length, 0) > MAX_REWRITES_PER_REQUEST) fail(`每次请求最多 ${MAX_REWRITES_PER_REQUEST} 个改写版本，请拆小批次。`);
  if (requireMetrics) await assertRequiredMetrics(db, items);
  await checkSharedLines(db, items.flatMap((item, index) => item.rewrites.map((rewrite, r) => ({ sourceKey: rewrite.sourceKey, pages: rewrite.pages, label: `第 ${index + 1} 条 rewrites 第 ${r + 1} 项` }))));
  const english = items.filter(item => isEnglishPsychologyPeerHit(item));
  const skipped = items.filter(item => !isEnglishPsychologyPeerHit(item));
  if (!english.length) {
    return {
      accepted: 0, ignoredOlder: 0, skippedNonEnglish: skipped.length, rewrites: { created: 0, duplicates: 0, conflicts: 0 },
      items: skipped.map(item => ({ id: item.id, videoUrl: item.videoUrl, status: "skipped_non_english" })),
    };
  }
  const columns = Object.values(FIELDS);
  const statements = english.flatMap(item => [db.prepare(`
    INSERT INTO ${TABLE} (id, video_key, video_url, platform, ${columns.join(",")}, collected_at, created_by, created_at, updated_at)
    VALUES (${Array(4 + columns.length + 4).fill("?").join(",")})
    ON CONFLICT(video_key) DO UPDATE SET
      video_url = excluded.video_url,
      ${columns.map(column => column === "video_data_json" ? `${column} = CASE WHEN excluded.${column} IS NULL THEN ${TABLE}.${column} ELSE json_patch(COALESCE(${TABLE}.${column}, '{}'), excluded.${column}) END` : column === "voice_gender" ? `${column} = CASE WHEN ? = 1 THEN excluded.${column} ELSE ${TABLE}.${column} END` : ["topics_json", "comments_json"].includes(column) ? `${column} = CASE WHEN ? = 1 THEN excluded.${column} ELSE ${TABLE}.${column} END` : column === "media_type" ? `${column} = CASE WHEN ${TABLE}.media_type_locked = 1 THEN ${TABLE}.${column} ELSE excluded.${column} END` : `${column} = COALESCE(excluded.${column}, ${TABLE}.${column})`).join(",")},
      collected_at = excluded.collected_at, updated_at = excluded.updated_at
    WHERE excluded.collected_at >= ${TABLE}.collected_at
    RETURNING id, video_url, collected_at
  `).bind(item.id, item.videoKey, item.videoUrl, item.platform,
    ...Object.keys(FIELDS).map(key => key === "videoData" ? (item.videoData != null ? JSON.stringify(item.videoData) : null) : key === "topics" || key === "topComments" ? JSON.stringify(item[key] || []) : item[key]),
    item.collectedAt, actor, now, now, item.voiceGenderProvided ? 1 : 0, item.topics != null ? 1 : 0, item.topComments != null ? 1 : 0),
    db.prepare(COPY_SYNC).bind(item.id,item.collectedAt)]);
  // Runs after every copy row exists, so a brand-new post completes in the same batch.
  const supplied = new Map();
  for (const item of english) {
    const content = importedCopy({ mediaType: item.mediaType, title: item.title || "", videoData: item.videoData || {} });
    if (!content) continue;
    supplied.set(item.id, content);
    if (content.skipped) { statements.push(db.prepare(COPY_SKIPPED).bind(content.skipped, now, item.id, item.mediaType, item.id, item.collectedAt)); continue; }
    statements.push(db.prepare(COPY_SUPPLIED).bind(JSON.stringify(content), now, now, item.id, item.mediaType, item.id, item.collectedAt));
  }
  const rewriteState = await planRewrites(db, english, actor);
  if (rewriteState.rows.length) statements.push(db.prepare(REWRITE_INSERT).bind(now, JSON.stringify(rewriteState.rows)));
  const results = await db.batch(statements);
  const saved = english.map((item,index) => ({item,result:results[index*2]}));
  const byId = new Map(saved.map(({item,result}) => [item.id, result.results?.length ? "saved" : "ignored_older"]));
  const copyRows = (await db.prepare("SELECT id,status,auto_extract FROM psychology_copy_library WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(english.map(item => item.id))).all()).results;
  const copyById = new Map(copyRows.map(row => [row.id, row]));
  return {
    accepted: saved.filter(({result}) => result.results?.length).length,
    ignoredOlder: saved.filter(({result}) => !result.results?.length).length,
    skippedNonEnglish: skipped.length,
    rewrites: rewriteState.totals,
    items: items.map(item => {
      const status = byId.get(item.id) || "skipped_non_english";
      if (status === "skipped_non_english") return { id: item.id, videoUrl: item.videoUrl, status };
      return { id: item.id, videoUrl: item.videoUrl, status, ...copyReport(item, copyById.get(item.id), supplied.get(item.id)), rewrites: rewriteState.byItem.get(item.id) };
    }),
  };
}
// Tells grokbot, per post, whether the factory still needs anything from it.
function copyReport(item, row, suppliedContent) {
  if (row?.status === "done") return { copy: "ready" };
  if (suppliedContent?.skipped) return { copy: "skipped", copyNote: suppliedContent.skipped };
  const textSupplied = Boolean(suppliedContent);
  if (row?.auto_extract === 0 || row?.auto_extract === "0") {
    return { copy: "needs_text", copyNote: item.mediaType === "photo" ? "历史爆款不会自动提取，请提交 videoData.pageTexts（按图片顺序 1–6 页）。" : "历史爆款不会自动提取，请提交 videoData.transcript。" };
  }
  const pageTexts = item.videoData?.pageTexts;
  const invalidText = item.mediaType === "photo" && pageTexts != null && !textSupplied;
  return { copy: row?.status === "failed" ? "failed" : "extracting",
    ...(invalidText ? { copyNote: "pageTexts 须为 1–6 页文字，已改由工厂自动识图。" } : {}) };
}
async function planRewrites(db, items, actor) {
  const totals = { created: 0, duplicates: 0, conflicts: 0 };
  const byItem = new Map(items.map(item => [item.id, { created: 0, duplicates: 0, conflicts: 0 }]));
  const wanted = items.flatMap(item => item.rewrites.map(rewrite => ({ item, rewrite })));
  if (!wanted.length) return { rows: [], totals, byItem };
  const owner = (await db.prepare("SELECT username FROM factory_users WHERE id=?").bind(actor).first())?.username;
  if (!owner) fail("写入账号不存在，无法保存改写版本。");
  for (const entry of wanted) entry.id = await sha256Hex(owner + ":" + entry.rewrite.externalId);
  const existing = new Map((await db.prepare("SELECT id,fingerprint FROM psychology_copy_variants WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(wanted.map(entry => entry.id))).all()).results.map(row => [row.id, row.fingerprint]));
  const rows = [], queued = new Set();
  for (const { item, rewrite, id } of wanted) {
    const counts = byItem.get(item.id);
    // Versions are immutable snapshots: a changed body under a reused ID is refused, never overwritten.
    const outcome = existing.has(id) || queued.has(id)
      ? (existing.get(id) ?? rows.find(row => row.id === id)?.fingerprint) === rewrite.fingerprint ? "duplicates" : "conflicts"
      : "created";
    counts[outcome]++; totals[outcome]++;
    if (outcome === "conflicts" || queued.has(id)) continue;
    queued.add(id);
    rows.push({ id, owner, externalId: rewrite.externalId, sourceKey: rewrite.sourceKey, title: rewrite.title, caption: rewrite.caption,
      pagesJson: JSON.stringify(rewrite.pages), fingerprint: rewrite.fingerprint, score:rewrite.score, scoreReason:rewrite.scoreReason, comparisonJson:rewrite.comparison?JSON.stringify(rewrite.comparison):"" });
  }
  return { rows, totals, byItem };
}
export async function listPsychologyPeerHits(db, params) {
  const requested = Number(params.get("page") || 1);
  if (!Number.isSafeInteger(requested) || requested < 1) fail("页码无效。");
  const query = String(params.get("query") || "").trim().slice(0, 200);
  const sort = params.get("sort") || "plays";
  const mediaType = String(params.get("mediaType") || "video").trim().toLowerCase();
  if (!["video", "photo"].includes(mediaType)) fail("内容类型无效。");
  const sorts = { plays: "play_count", collected: "collected_at", published: "published_at" };
  if (!Object.hasOwn(sorts, sort)) fail("排序方式无效。");
  const filter = query ? " WHERE media_type = ? AND (title LIKE ? OR account_name LIKE ? OR account_username LIKE ? OR video_url LIKE ?)" : " WHERE media_type = ?";
  const binds = query ? [mediaType, ...Array(4).fill("%" + query + "%")] : [mediaType];
  const total = Number((await db.prepare(`SELECT COUNT(*) AS total FROM ${TABLE}${filter}`).bind(...binds).first())?.total || 0);
  const pageSize = 20, totalPages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(requested, totalPages);
  const rows = await db.prepare(`SELECT * FROM ${TABLE}${filter} ORDER BY ${sorts[sort]} DESC, id DESC LIMIT ? OFFSET ?`).bind(...binds, pageSize, (page - 1) * pageSize).all();
  return { items: (rows.results || []).map(psychologyPeerHitFromRow), total, page, pageSize, totalPages };
}

export async function deletePsychologyPeerHit(db, id) {
  const value = String(id || "").trim().toLowerCase();
  if (!/^psy-[a-f0-9]{32}$/.test(value)) fail("视频编号无效。");
  const result = await db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).bind(value).run();
  if (!Number(result.meta?.changes)) {
    const error = new Error("没有找到这条视频。");
    error.statusCode = 404;
    throw error;
  }
}

export async function updatePsychologyPeerHitVoiceGender(db, id, voiceGender) {
  const value = String(id || "").trim().toLowerCase();
  if (!/^psy-[a-f0-9]{32}$/.test(value)) fail("内容编号无效。");
  const gender = normalizeVoiceGender(voiceGender, null);
  if (!gender) fail("voiceGender 是必填字段。");
  const result = await db.prepare(`UPDATE ${TABLE} SET voice_gender = ?, updated_at = ? WHERE id = ?`).bind(gender, Date.now(), value).run();
  if (!Number(result.meta?.changes)) {
    const error = new Error("没有找到这条内容。");
    error.statusCode = 404;
    throw error;
  }
  return { id: value, voiceGender: gender };
}

export async function updatePsychologyPeerHitMediaType(db, id, mediaType) {
  const value = String(id || "").trim().toLowerCase();
  if (!/^psy-[a-f0-9]{32}$/.test(value)) fail("内容编号无效。");
  const type = String(mediaType || "").trim().toLowerCase();
  if (!["video", "photo"].includes(type)) fail("mediaType 只能是 video 或 photo。");
  const now=Date.now();
  const [result]=await db.batch([
    db.prepare(`UPDATE ${TABLE} SET media_type = ?, media_type_locked = 1, updated_at = ? WHERE id = ? RETURNING id`).bind(type,now,value),
    db.prepare(COPY_SYNC_BY_ID).bind(value)
  ]);
  if (!result.results?.length) {
    const error = new Error("没有找到这条内容。");
    error.statusCode = 404;
    throw error;
  }
  return { id: value, mediaType: type };
}

export function watchUsername(value) {
  const name = String(value || "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{2,64}$/.test(name)) fail("对标账号用户名无效。");
  return name;
}
export async function listWatchAccounts(db) {
  const rows = await db.prepare("SELECT username, note, enabled, created_at FROM psychology_peer_watch_accounts ORDER BY username").all();
  return { accounts: (rows.results || []).map(row => ({ username: row.username, note: row.note, enabled: row.enabled !== 0, createdAt: row.created_at })) };
}
export async function saveWatchAccount(db, actor, input) {
  const username = watchUsername(input?.username);
  const note = optionalText(input?.note, 200, "note") || "";
  const count = Number((await db.prepare("SELECT COUNT(*) n FROM psychology_peer_watch_accounts").first())?.n || 0);
  const exists = await db.prepare("SELECT username FROM psychology_peer_watch_accounts WHERE username=?").bind(username).first();
  if (!exists && count >= 100) fail("对标账号最多 100 个。");
  await db.prepare(`INSERT INTO psychology_peer_watch_accounts(username,note,enabled,created_by,created_at) VALUES(?,?,1,?,?)
    ON CONFLICT(username) DO UPDATE SET note=excluded.note, enabled=1`).bind(username, note, actor, Date.now()).run();
  return { username, note };
}
export async function deleteWatchAccount(db, username) {
  const name = watchUsername(username);
  const result = await db.prepare("DELETE FROM psychology_peer_watch_accounts WHERE username=?").bind(name).run();
  if (!Number(result.meta?.changes)) { const error = new Error("没有这个对标账号。"); error.statusCode = 404; throw error; }
  return { ok: true };
}
export async function peerWorklist(db) {
  const [watch, enrich] = await Promise.all([
    db.prepare("SELECT username, note FROM psychology_peer_watch_accounts WHERE enabled=1 ORDER BY username").all(),
    db.prepare(`SELECT video_url, account_username, topics_json, comments_json, comment_count FROM ${TABLE} WHERE media_type='photo' AND (topics_json='[]' OR (COALESCE(comment_count,0)>0 AND comments_json='[]')) ORDER BY COALESCE(play_count,0) DESC, id LIMIT 40`).all(),
  ]);
  return {
    watchAccounts: (watch.results || []).map(row => ({ username: row.username, note: row.note })),
    enrich: (enrich.results || []).map(row => ({ videoUrl: row.video_url, accountUsername: row.account_username, missing: [row.topics_json === "[]" ? "topics" : null, Number(row.comment_count) > 0 && row.comments_json === "[]" ? "topComments" : null].filter(Boolean) })),
  };
}
