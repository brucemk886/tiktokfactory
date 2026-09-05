import { collectOfficialBatchIdsFromRecords, isOfficialTikTokPublishRecord } from "./publish-record-sources.js";

export function mergeOfficialPublishRecords(existing, incoming, { limit = 3000 } = {}) {
  const byId = new Map();
  for (const record of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!record || typeof record !== "object") continue;
    const id = String(record.id || record.dedupeKey || record.taskId || record.jobId || "").trim();
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, prev ? mergeOfficialRecordFields(prev, record) : { ...record, id });
  }
  const merged = Array.from(byId.values())
    .map((item) => normalizeOfficialPublishRecord(item))
    .filter(Boolean)
    .sort((a, b) => officialRecordTime(b) - officialRecordTime(a));
  return Number(limit) > 0 ? merged.slice(0, Number(limit)) : merged;
}

export function isMatchableOfficialRecord(record) {
  if (!record || typeof record !== "object") return false;
  return Boolean(
    record.videoId
    || record.tiktokVideoId
    || record.audioLibraryId
    || record.audioId
    || record.sourceAudioId
    || record.audioName
    || record.scriptId
    || record.novelId
  );
}

export function normalizeOfficialPublishRecord(record) {
  if (!record || typeof record !== "object") return null;
  const id = String(record.id || record.dedupeKey || record.taskId || record.jobId || "").trim();
  const videoId = String(record.videoId || record.tiktokVideoId || record.itemId || "").trim();
  const username = String(record.accountUsername || record.username || record.tiktokUsername || record.account || "").replace(/^@/, "").trim();
  const accountName = String(record.accountName || record.displayName || username).replace(/^@/, "").trim();
  const connectionId = String(record.connectionId || record.assignedEnvId || record.account || "").trim();
  const createdAt = officialRecordTime(record);
  const scheduleAt = toSeconds(record.scheduleAt) || toSeconds(record.publishedAt) || (createdAt ? Math.floor(createdAt / 1000) : 0);
  const batchIds = uniqueIds([
    ...(Array.isArray(record.officialBatchIds) ? record.officialBatchIds : []),
    ...(Array.isArray(record.taskIds) ? record.taskIds : []),
    record.batchId,
    record.remoteTaskId,
    record.externalRef
  ]);
  const status = String(record.status || (videoId ? "published" : "")).trim();
  return {
    ...record,
    id: id || (videoId ? `official:${videoId}` : ""),
    dedupeKey: String(record.dedupeKey || id || "").trim(),
    createdAt,
    updatedAt: toMillis(record.updatedAt) || createdAt,
    publishedAt: toMillis(record.publishedAt) || createdAt,
    scheduleAt,
    username,
    accountUsername: username,
    accountName: accountName || username || connectionId,
    connectionId,
    assignedEnvId: String(record.assignedEnvId || connectionId).trim(),
    fileName: String(record.fileName || record.title || record.audioName || "").trim(),
    title: String(record.title || record.fileName || record.audioName || "").trim(),
    audioName: String(record.audioName || record.audioFileName || "").trim(),
    videoId,
    status,
    officialBatchIds: batchIds,
    taskIds: Array.isArray(record.taskIds) && record.taskIds.length ? record.taskIds : batchIds,
    batchId: String(record.batchId || batchIds[0] || "").trim(),
    autoTaskId: String(record.autoTaskId || record.taskId || "").trim(),
    note: String(record.note || record.message || "").trim(),
    source: record.source || (isOfficialTikTokPublishRecord(record) || isMatchableOfficialRecord(record) ? "official-tiktok" : record.source || ""),
    provider: record.provider || "official"
  };
}

export function summarizeOfficialPublishRecords(records, { range = "7d", query = "" } = {}) {
  const from = resolveStatsFrom(range);
  const needle = String(query || "").trim().toLowerCase();
  const normalized = (Array.isArray(records) ? records : [])
    .map((item) => normalizeOfficialPublishRecord(item))
    .filter(Boolean)
    .filter((item) => item.id);
  const filtered = normalized
    .filter((record) => !from || officialRecordTime(record) >= from)
    .filter((record) => !needle || JSON.stringify(record).toLowerCase().includes(needle))
    .sort((a, b) => officialRecordTime(b) - officialRecordTime(a));
  const batchIds = collectOfficialBatchIdsFromRecords(filtered);
  return {
    records: filtered,
    summary: {
      recordCount: filtered.length,
      batchCount: batchIds.length,
      accountCount: new Set(filtered.map((item) => item.connectionId || item.accountName || item.username).filter(Boolean)).size,
      submittedCount: filtered.filter((item) => ["submitted", "done", "published"].includes(String(item.status || ""))).length,
      taskCount: filtered.length
    }
  };
}

const TERMINAL_REMOTE_FAILURES = new Set(["failed", "rejected", "status_timeout", "needs_review", "canceled", "enqueue_failed"]);
const FAIL_REASON_LABELS = {
  spam_risk: "TikTok 审核判定这次发布有风险，没有更细原因，官方要求不要重试",
  spam_risk_text: "文案被判定有垃圾或风险内容，不要重试",
  spam_risk_too_many_posts: "该账号 24 小时内通过开放接口发得太多，请改用 TikTok App",
  spam_risk_too_many_pending_share: "该账号待发布草稿太多",
  spam_risk_user_banned_from_posting: "该账号已被 TikTok 禁止发新帖，不要重试",
  picture_size: "封面或图片尺寸不符合限制",
  picture_size_check_failed: "封面或图片尺寸不符合限制",
  duration: "时长不符合 TikTok 限制",
  duration_check_failed: "时长不符合 TikTok 限制",
  file_format: "文件格式不符合 TikTok 限制",
  file_format_check_failed: "文件格式不符合 TikTok 限制",
  frame_rate: "帧率不符合 TikTok 限制",
  frame_rate_check_failed: "帧率不符合 TikTok 限制",
  video_pull_failed: "TikTok 拉不到视频文件（地址无法访问或超时）",
  photo_pull_failed: "TikTok 拉不到图片文件（地址无法访问或超时）",
  internal: "TikTok 服务端异常，可以稍后重试",
  auth_removed: "发布过程中账号取消了授权，不要重试",
  publish_cancelled: "发布已被取消",
  privacy_level_not_authorized: "该账号未授权所选隐私级别"
};

export function officialFailReasonLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const mapped = FAIL_REASON_LABELS[raw.toLowerCase()];
  return mapped ? `${mapped}（${raw}）` : raw;
}

export function officialBatchUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

export function collectOfficialLiveBatchIds(records, limit = 20, { skipResolved = false } = {}) {
  const ids = [];
  const seen = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    if (skipResolved && String(record?.videoId || record?.tiktokVideoId || "").trim()) continue;
    const candidates = [
      record?.batchId,
      ...(Array.isArray(record?.officialBatchIds) ? record.officialBatchIds : []),
      ...(Array.isArray(record?.taskIds) ? record.taskIds : [])
    ];
    for (const value of candidates) {
      const id = String(value || "").trim();
      if (!officialBatchUuid(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= limit) return ids;
    }
  }
  return ids;
}

export function filterOfficialPublishRecordsByRange(records, range = "7d") {
  const from = resolveStatsFrom(range);
  return (Array.isArray(records) ? records : [])
    .map((item) => normalizeOfficialPublishRecord(item))
    .filter(Boolean)
    .filter((item) => item.id && (!from || officialRecordTime(item) >= from));
}

export async function hydrateOfficialPublishRecords(records, fetchBatch, options = {}) {
  const list = Array.isArray(records) ? records : [];
  const batchIds = collectOfficialLiveBatchIds(list, options.limit || 20, options);
  if (!batchIds.length || typeof fetchBatch !== "function") return list;
  const settled = await Promise.allSettled(batchIds.map((id) => fetchBatch(id)));
  const batches = [];
  for (const result of settled) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const batch = result.value.batch || result.value;
    if (batch && typeof batch === "object") batches.push(batch);
  }
  return attachOfficialRemoteOutcomes(list, batches);
}

export function findOfficialRemoteTask(record, tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const remoteTaskId = String(record?.remoteTaskId || "").trim();
  const externalRef = String(record?.externalRef || "").trim();
  const connectionId = String(record?.connectionId || "").trim();
  const fileName = String(record?.fileName || "").trim();
  return (remoteTaskId && list.find((task) => String(task?.id || "").trim() === remoteTaskId))
    || (externalRef && list.find((task) => String(task?.externalRef || "").trim() === externalRef))
    || (connectionId && fileName && list.find((task) => String(task?.connectionId || "").trim() === connectionId && String(task?.fileName || "").trim() === fileName))
    || null;
}

export function applyOfficialRemoteOutcome(record, remote) {
  if (!record || !remote) return record;
  const username = String(remote.username || record.accountUsername || record.username || "").replace(/^@/, "").trim();
  const remoteStatus = String(remote.status || "").toLowerCase();
  const reason = String(remote.error || "").trim();
  const published = remoteStatus === "published" || remoteStatus === "publish_complete";
  const failed = TERMINAL_REMOTE_FAILURES.has(remoteStatus);
  return {
    ...record,
    username: username || record.username,
    accountUsername: username || record.accountUsername,
    officialRemoteStatus: remoteStatus || record.officialRemoteStatus || "",
    publishError: reason || record.publishError || "",
    videoId: String(remote.videoId || record.videoId || "").trim(),
    shareLink: String(remote.videoUrl || record.shareLink || ""),
    videoUrl: String(remote.videoUrl || record.videoUrl || ""),
    status: published ? "published" : failed ? "failed" : record.status,
    note: published
      ? (record.note && record.note.includes("已确认") ? record.note : "TikTok 官方 API 已确认发布成功")
      : failed
        ? (reason ? `TikTok 拒绝：${officialFailReasonLabel(reason)}` : `TikTok 发布失败：${remoteStatus}`)
        : record.note
  };
}

export function attachOfficialRemoteOutcomes(records, batches) {
  const list = Array.isArray(records) ? records : [];
  const tasks = (Array.isArray(batches) ? batches : []).flatMap((batch) => Array.isArray(batch?.tasks) ? batch.tasks : []);
  if (!tasks.length) return list;
  return list.map((record) => {
    const remote = findOfficialRemoteTask(record, tasks);
    return remote ? applyOfficialRemoteOutcome(record, remote) : record;
  });
}

export function officialRecordTime(record) {
  return toMillis(record?.createdAt)
    || toMillis(record?.publishedAt)
    || toMillis(record?.updatedAt)
    || (toSeconds(record?.scheduleAt) ? toSeconds(record.scheduleAt) * 1000 : 0);
}

export function officialRecordKey(record) {
  return String(record?.id || record?.dedupeKey || record?.taskId || record?.jobId || "").trim();
}

export function compactOfficialPublishRecord(record) {
  const item = normalizeOfficialPublishRecord(record) || {};
  return {
    id: item.id,
    dedupeKey: item.dedupeKey,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    publishedAt: item.publishedAt,
    scheduleAt: item.scheduleAt,
    username: item.username,
    accountName: item.accountName,
    accountUsername: item.accountUsername,
    connectionId: item.connectionId,
    assignedEnvId: item.assignedEnvId,
    fileName: item.fileName,
    title: item.title,
    audioName: item.audioName,
    videoId: item.videoId,
    status: item.status,
    officialBatchIds: item.officialBatchIds,
    taskIds: item.taskIds,
    batchId: item.batchId,
    autoTaskId: item.autoTaskId,
    remoteTaskId: item.remoteTaskId || "",
    externalRef: item.externalRef || "",
    publishError: item.publishError || "",
    note: String(item.note || "").slice(0, 180),
    source: item.source || "official-tiktok",
    provider: item.provider || "official",
    audioLibraryId: item.audioLibraryId || "",
    sourceAudioId: item.sourceAudioId || "",
    scriptId: item.scriptId || "",
    novelId: item.novelId || "",
    shareLink: item.shareLink || "",
    videoUrl: item.videoUrl || "",
  };
}

export function mergeOfficialRecordFields(prev, next) {
  const merged = { ...prev };
  for (const [key, value] of Object.entries(next)) {
    if (value == null) continue;
    if (value === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    merged[key] = value;
  }
  return merged;
}

export function publishRecordsSince(range = "7d") {
  return resolveStatsFrom(range);
}

function resolveStatsFrom(range) {
  const now = Date.now();
  if (range === "1d") return now - 24 * 60 * 60 * 1000;
  if (range === "7d") return now - 7 * 24 * 60 * 60 * 1000;
  if (range === "30d") return now - 30 * 24 * 60 * 60 * 1000;
  return 0;
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

function uniqueIds(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}
