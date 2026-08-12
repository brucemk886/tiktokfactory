import fs from "node:fs";
import path from "node:path";

const DAY_MS = 86_400_000;
const DEFAULT_SYNC_HOUR = 8;
const DEFAULT_SYNC_MINUTE = 30;
const NEEDS_REVIEW_AFTER_DAYS = 7;
const SNAPSHOT_TRACKING_DAYS = 400;
const TERMINAL_FAILURES = new Set(["failed", "rejected", "status_timeout", "needs_review", "canceled"]);

export function createOfficialPublishResultSync({
  workDir,
  service,
  readRecords,
  writeRecords,
  now = () => Date.now(),
  syncHour = DEFAULT_SYNC_HOUR,
  syncMinute = DEFAULT_SYNC_MINUTE,
  requestIntervalMs = 650,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  logger = console,
} = {}) {
  if (!workDir || !service || !readRecords || !writeRecords) throw new Error("Official publish result sync is not configured.");
  const statePath = path.join(workDir, "official-publish-result-sync-state.json");
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
    const state = readJson(statePath, {});
    if (!ignoreDailyGuard && state.lastRunDate === dateKey) {
      return { skipped: true, reason: "already_synced_today", ...state.lastResult };
    }

    const records = readRecords();
    const due = selectDueOfficialPublishRecords(records, startedAt);
    const unresolved = due.filter((record) => String(record.status || "").toLowerCase() !== "published");
    const dueByBatch = groupByBatch(unresolved);
    const updates = new Map();
    const summary = { due: due.length, batches: dueByBatch.size, published: 0, failed: 0, pending: 0, details: 0, needsReview: 0 };

    for (const record of due.filter((item) => String(item.status || "").toLowerCase() === "published")) {
      updates.set(record.id, { updatedAt: startedAt });
    }

    for (const [batchId, batchRecords] of dueByBatch) {
      let batch;
      try {
        batch = (await callBridge(() => service.getPublishBatch(batchId)))?.batch;
      } catch (error) {
        for (const record of batchRecords) updates.set(record.id, failedCheckUpdate(record, error, startedAt, summary));
        continue;
      }
      const remoteTasks = Array.isArray(batch?.tasks) ? batch.tasks : [];
      for (const record of batchRecords) {
        const remote = findRemoteTask(record, remoteTasks);
        if (!remote) {
          updates.set(record.id, unresolvedUpdate(record, "线上批次中未找到对应发布任务", startedAt, summary));
          continue;
        }
        const remoteStatus = String(remote.status || "").toLowerCase();
        const videoId = String(remote.videoId || "").trim();
        const published = remoteStatus === "published";
        const failed = TERMINAL_FAILURES.has(remoteStatus);
        const update = {
          officialRemoteStatus: remoteStatus,
          remoteTaskId: String(remote.id || record.remoteTaskId || ""),
          publishId: String(remote.publishId || record.publishId || ""),
          videoId: videoId || String(record.videoId || ""),
          videoUrl: String(remote.videoUrl || record.videoUrl || ""),
          shareLink: String(remote.videoUrl || record.shareLink || ""),
          submittedAt: Number(remote.submittedAt || record.submittedAt || 0),
          completedAt: Number(remote.completedAt || record.completedAt || 0),
          publishedAt: Number(remote.publishedAt || record.publishedAt || remote.completedAt || 0),
          lastOfficialResultCheckAt: startedAt,
          officialResultCheckCount: Number(record.officialResultCheckCount || 0) + 1,
          officialResultError: "",
          updatedAt: startedAt,
        };

        if (published) {
          update.status = "published";
          update.note = "TikTok 官方 API 已确认发布成功";
          summary.published += 1;
          if (videoId) update.officialVideoDetailStatus = "pending";
        } else if (failed) {
          update.status = "failed";
          update.note = String(remote.error || `TikTok 发布失败：${remoteStatus}`);
          summary.failed += 1;
        } else {
          update.status = "submitted";
          update.note = `TikTok 仍在处理：${remoteStatus || "queued"}`;
          summary.pending += 1;
        }
        updates.set(record.id, update);
      }
    }

    for (const record of unresolved.filter((item) => !batchIdOf(item))) {
      updates.set(record.id, unresolvedUpdate(record, "本地记录缺少线上批次 ID", startedAt, summary));
    }
    await hydrateVideoDetailsByAccount(due, updates, service, startedAt, summary, callBridge);
    const latest = readRecords();
    writeRecords(latest.map((record) => updates.has(record.id) ? { ...record, ...updates.get(record.id) } : record));
    const result = { ...summary, completedAt: now() };
    writeJson(statePath, { lastRunDate: dateKey, lastRunAt: startedAt, lastResult: result });
    return result;
  }

  function start() {
    scheduleNext();
    return getStatus();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer);
    const current = now();
    const state = readJson(statePath, {});
    const todayTarget = beijingTimeForDate(current, syncHour, syncMinute);
    const shouldCatchUp = current >= todayTarget && state.lastRunDate !== beijingDateKey(current);
    const target = shouldCatchUp ? current + 10_000 : nextBeijingRun(current, syncHour, syncMinute);
    timer = setTimeout(async () => {
      try { await run(); } catch (error) { logger.error("Official publish result sync failed:", error); }
      scheduleNext();
    }, Math.max(1_000, target - current));
    timer.unref?.();
  }

  function getStatus() {
    const state = readJson(statePath, {});
    return { running: Boolean(running), syncHour, syncMinute, ...state };
  }

  return { run, start, stop, getStatus };
}

async function hydrateVideoDetailsByAccount(records, updates, service, currentTime, summary, callBridge) {
  const byAccount = new Map();
  for (const record of records) {
    const update = updates.get(record.id) || {};
    const videoId = String(update.videoId || record.videoId || "").trim();
    if (!videoId || String(update.status || record.status || "").toLowerCase() !== "published") continue;
    const accountId = accountKey(record.connectionId);
    if (!byAccount.has(accountId)) byAccount.set(accountId, []);
    byAccount.get(accountId).push({ record, update, videoId });
  }
  for (const [accountId, items] of byAccount) {
    try {
      const result = await callBridge(() => service.listVideos({
        schema: accountId,
        limit: 100,
        includePrivate: true,
        includeHistory: true,
        snapshotDays: SNAPSHOT_TRACKING_DAYS,
      }));
      const profile = result?.profile || null;
      const videos = new Map((Array.isArray(result?.videos) ? result.videos : []).map((video) => [String(video?.id || ""), video]));
      for (const item of items) {
        const video = videos.get(item.videoId);
        if (!video) {
          item.update.officialVideoDetailStatus = "pending";
          item.update.officialVideoDetailError = "视频详情尚未进入线上官方数据缓存";
          continue;
        }
        item.update.officialVideo = video;
        if (profile) item.update.officialAccountProfile = profile;
        item.update.officialVideoSnapshots = mergeDailySnapshots(
          item.record.officialVideoSnapshots,
          Array.isArray(video.snapshots) && video.snapshots.length
            ? video.snapshots
            : [{ ...video, snapshotDate: beijingDateKey(Number(video.syncedAt || currentTime)), syncedAt: Number(video.syncedAt || currentTime) }],
        );
        item.update.officialAccountSnapshots = mergeDailySnapshots(
          item.record.officialAccountSnapshots,
          Array.isArray(result?.profileSnapshots) && result.profileSnapshots.length
            ? result.profileSnapshots
            : profile ? [{ ...profile, snapshotDate: beijingDateKey(Number(profile.syncedAt || currentTime)), syncedAt: Number(profile.syncedAt || currentTime) }] : [],
        );
        item.update.officialVideoDetailSyncedAt = currentTime;
        item.update.officialVideoDetailStatus = "synced";
        item.update.officialVideoDetailError = "";
        summary.details += 1;
      }
    } catch (error) {
      for (const item of items) {
        item.update.officialVideoDetailStatus = "pending";
        item.update.officialVideoDetailError = cleanError(error);
      }
    }
  }
}

export function selectDueOfficialPublishRecords(records, currentTime = Date.now()) {
  return (Array.isArray(records) ? records : []).filter((record) => {
    if (!isOfficial(record) || TERMINAL_FAILURES.has(String(record.status || "").toLowerCase())) return false;
    const scheduledAt = Math.max(0, Number(record.scheduleAt || 0) * 1000 || Number(record.createdAt || 0));
    if (!(scheduledAt > 0) || beijingDateKey(currentTime) <= beijingDateKey(scheduledAt)) return false;
    if (String(record.status || "").toLowerCase() !== "published") return true;
    const publishedAt = Math.max(0, Number(record.publishedAt || record.completedAt || scheduledAt));
    if (currentTime - publishedAt > SNAPSHOT_TRACKING_DAYS * DAY_MS) return false;
    return !hasSnapshotForDate(record.officialVideoSnapshots, beijingDateKey(currentTime));
  });
}

function hasSnapshotForDate(values, dateKey) {
  return (Array.isArray(values) ? values : []).some((value) => String(value?.snapshotDate || "") === dateKey);
}

function mergeDailySnapshots(existing, incoming) {
  const byDate = new Map();
  for (const value of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const syncedAt = Number(value?.syncedAt || value?.fetchedAt || 0);
    const snapshotDate = String(value?.snapshotDate || (syncedAt ? beijingDateKey(syncedAt) : ""));
    if (!snapshotDate) continue;
    const normalized = { ...value, snapshotDate, syncedAt };
    const current = byDate.get(snapshotDate);
    if (!current || Number(current.syncedAt || 0) <= syncedAt) byDate.set(snapshotDate, normalized);
  }
  return [...byDate.values()].sort((left, right) => String(left.snapshotDate).localeCompare(String(right.snapshotDate)));
}

function failedCheckUpdate(record, error, currentTime, summary) {
  return unresolvedUpdate(record, cleanError(error), currentTime, summary, true);
}

function unresolvedUpdate(record, message, currentTime, summary, requestFailed = false) {
  const scheduledAt = Math.max(0, Number(record.scheduleAt || 0) * 1000 || Number(record.createdAt || 0));
  const expired = currentTime - scheduledAt >= NEEDS_REVIEW_AFTER_DAYS * DAY_MS;
  if (expired) summary.needsReview += 1;
  else summary.pending += 1;
  return {
    status: expired ? "needs_review" : "submitted",
    note: expired ? `连续 ${NEEDS_REVIEW_AFTER_DAYS} 天未取得最终发布结果，需要人工检查` : String(record.note || "等待下次每日同步"),
    lastOfficialResultCheckAt: currentTime,
    officialResultCheckCount: Number(record.officialResultCheckCount || 0) + 1,
    officialResultError: message,
    officialResultRequestFailed: requestFailed,
    updatedAt: currentTime,
  };
}

function groupByBatch(records) {
  const result = new Map();
  for (const record of records) {
    const batchId = batchIdOf(record);
    if (!batchId) continue;
    if (!result.has(batchId)) result.set(batchId, []);
    result.get(batchId).push(record);
  }
  return result;
}

function findRemoteTask(record, tasks) {
  return tasks.find((task) => String(task.id || "") === String(record.remoteTaskId || ""))
    || tasks.find((task) => String(task.externalRef || "") === String(record.externalRef || ""))
    || tasks.find((task) => String(task.connectionId || "") === String(record.connectionId || "") && String(task.fileName || "") === String(record.fileName || ""));
}

function batchIdOf(record) {
  return String(record.batchId || record.officialBatchIds?.[0] || record.taskIds?.[0] || "").trim();
}

function accountKey(connectionId) {
  const value = String(connectionId || "").trim();
  return value.startsWith("tiktok:") ? value : `tiktok:${value}`;
}

function isOfficial(record) {
  return record?.provider === "official" || record?.source === "official-tiktok";
}

function beijingDateKey(timestamp) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}

function beijingTimeForDate(timestamp, hour, minute = 0) {
  const date = beijingDateKey(timestamp);
  return Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
}

export function nextBeijingRun(timestamp, hour, minute = 0) {
  const today = beijingTimeForDate(timestamp, hour, minute);
  return timestamp < today ? today : today + DAY_MS;
}

function cleanError(error) {
  return String(error?.message || error || "未知错误").slice(0, 500);
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}
