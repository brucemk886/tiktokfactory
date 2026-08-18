import { collectOfficialBatchIdsFromRecords, isOfficialTikTokPublishRecord } from "./publish-record-sources.js";

export function mergeOfficialPublishRecords(existing, incoming) {
  const byId = new Map();
  for (const record of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!record || typeof record !== "object") continue;
    const id = String(record.id || record.dedupeKey || record.taskId || record.jobId || "").trim();
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, prev ? mergeRecordFields(prev, record) : { ...record, id });
  }
  return Array.from(byId.values())
    .map((item) => normalizeOfficialPublishRecord(item))
    .filter(Boolean)
    .sort((a, b) => officialRecordTime(b) - officialRecordTime(a))
    .slice(0, 3000);
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

export function officialRecordTime(record) {
  return toMillis(record?.createdAt)
    || toMillis(record?.publishedAt)
    || toMillis(record?.updatedAt)
    || (toSeconds(record?.scheduleAt) ? toSeconds(record.scheduleAt) * 1000 : 0);
}

function mergeRecordFields(prev, next) {
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
