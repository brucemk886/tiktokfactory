import { audioItemsFromScripts, buildOverview } from "./novel-overview.js";

export function assembleOfficialNovelEffects({
  store,
  audioItems,
  signals,
  records = [],
  query = "",
  days = 30,
  label = "官方归档",
} = {}) {
  const videos = flattenOfficialVideos(signals, normalizeRecords(records));
  const overview = buildOverview(store, audioItems || audioItemsFromScripts(store?.scripts || []), videos, query);
  return {
    ...decorate(overview, {
      source: "official_api",
      label,
      status: signals?.status || (signals?.connected ? "ready" : "unavailable"),
      error: signals?.error || "",
      rawVideoCount: countOfficialVideos(signals),
      mappedVideoCount: videos.filter(hasContentMapping).length,
      days,
      archiveDate: signals?.archiveDate || "",
      archiveAt: Number(signals?.archiveAt) || 0,
    }),
    videoMappings: videos.map((video) => ({
      videoId: clean(video.videoId || video.itemId || video.id),
      username: clean(video.username),
      publishedAt: Number(video.publishedAt) || 0,
      local: video.local || {},
    })),
  };
}

export function decorate(overview = {}, dataStatus) {
  const novels = Array.isArray(overview.novels) ? overview.novels : [];
  return {
    ...overview,
    novels,
    unassignedScripts: Array.isArray(overview.unassignedScripts) ? overview.unassignedScripts : [],
    summary: enrichSummary(overview.summary, novels),
    dataStatus,
  };
}

export function enrichSummary(summary = {}, novels = []) {
  const scripts = novels.flatMap((novel) => Array.isArray(novel.scripts) ? novel.scripts : []);
  const videos = scripts.flatMap((script) => Array.isArray(script.videos) ? script.videos : []);
  return {
    ...summary,
    novelCount: Number(summary.novelCount || novels.length),
    scriptCount: Number(summary.scriptCount || scripts.length),
    audioCount: Number(summary.audioCount || scripts.filter((script) => script.audio).length),
    videoCount: Number(summary.videoCount || videos.length),
    testedAccountCount: new Set(videos.map((video) => video.username).filter(Boolean)).size,
    totalViews: sum(videos, "views"),
    comments: sum(videos, "comments"),
    averageTimeWatched: weightedAverage(videos, "averageTimeWatched"),
    fullWatchRate: weightedAverage(videos, "fullWatchRate"),
    retentionAt3: weightedAverage(videos, "retentionAt3"),
  };
}

export function flattenOfficialVideos(signals, records) {
  const byVideoId = new Map();
  const byUsername = new Map();
  for (const record of records) {
    for (const videoId of record.videoIds) {
      if (videoId) byVideoId.set(videoId, record);
    }
    if (record.username && record.publishedAt) {
      const list = byUsername.get(record.username) || [];
      list.push(record);
      byUsername.set(record.username, list);
    }
  }
  const output = [];
  for (const account of Array.isArray(signals?.accounts) ? signals.accounts : []) {
    for (const video of Array.isArray(account?.videos) ? account.videos : []) {
      output.push({
        ...video,
        username: video.username || account.username || account.profile?.username || "",
        accountId: video.accountId || account.accountId || account.id || "",
        publishedAt: normalizeTimestamp(video.publishedAt || video.createdAt || video.createTime),
        local: findLocalMapping(video, account, byVideoId, byUsername),
      });
    }
  }
  return output;
}

export function normalizeRecords(records) {
  const flattened = [];
  visitRecords(records, flattened);
  return flattened.map((record) => ({
    videoIds: new Set(collectStrings(record, ["videoId", "tiktokVideoId", "itemId", "publishVideoId"])),
    username: clean(record.username || record.accountName || record.tiktokUsername || record.account?.username).toLowerCase(),
    publishedAt: normalizeTimestamp(record.publishedAt || record.actualPublishedAt || record.publishTime || record.scheduledAt),
    local: {
      audioLibraryId: clean(record.audioLibraryId || record.audioId || record.sourceAudioId || record.local?.audioLibraryId),
      sourceAudioId: clean(record.sourceAudioId || record.local?.sourceAudioId),
      audioName: clean(record.audioName || record.audioFileName || record.local?.audioName),
      scriptId: clean(record.scriptId || record.local?.scriptId),
      novelId: clean(record.novelId || record.local?.novelId),
      publishRecordId: clean(record.id || record.taskId || record.jobId),
    },
  }));
}

export function countOfficialVideos(signals) {
  return (Array.isArray(signals?.accounts) ? signals.accounts : []).reduce(
    (total, account) => total + (Array.isArray(account?.videos) ? account.videos.length : 0), 0
  );
}

function findLocalMapping(video, account, byVideoId, byUsername) {
  const videoId = clean(video.videoId || video.itemId || video.id);
  const username = clean(video.username || account.username || account.profile?.username).toLowerCase();
  const publishedAt = normalizeTimestamp(video.publishedAt || video.createdAt || video.createTime);
  let record = videoId ? byVideoId.get(videoId) : null;
  if (!record && username && publishedAt) {
    record = (byUsername.get(username) || [])
      .filter((item) => item.publishedAt)
      .sort((a, b) => Math.abs(a.publishedAt - publishedAt) - Math.abs(b.publishedAt - publishedAt))
      .find((item) => Math.abs(item.publishedAt - publishedAt) <= 30 * 60 * 1000);
  }
  return record?.local || {};
}

function visitRecords(value, output, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) visitRecords(item, output, seen);
    return;
  }
  if (value.videoId || value.tiktokVideoId || value.audioLibraryId || value.audioId || value.sourceAudioId) output.push(value);
  for (const key of ["records", "items", "jobs", "tasks", "results", "videos", "children"]) visitRecords(value[key], output, seen);
}

function collectStrings(record, keys) {
  const values = [];
  for (const key of keys) {
    const value = record?.[key] ?? record?.result?.[key] ?? record?.publishResult?.[key];
    if (Array.isArray(value)) values.push(...value.map(clean).filter(Boolean));
    else if (value !== undefined && value !== null && clean(value)) values.push(clean(value));
  }
  return values;
}

function hasContentMapping(video) {
  return Boolean(video.local?.audioLibraryId || video.local?.sourceAudioId || video.local?.audioName || video.local?.scriptId);
}

function normalizeTimestamp(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number < 1e12 ? number * 1000 : number;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item?.[key]) || 0), 0);
}

function weightedAverage(items, key) {
  let total = 0;
  let weight = 0;
  for (const item of items) {
    const value = Number(item?.[key]);
    if (!Number.isFinite(value)) continue;
    const nextWeight = Math.max(1, Number(item?.views) || 0);
    total += value * nextWeight;
    weight += nextWeight;
  }
  return weight ? total / weight : null;
}

function clean(value) {
  return String(value ?? "").trim();
}
