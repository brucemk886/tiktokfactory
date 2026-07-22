import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createGeeLarkClient } from "./geelark-client.js";

const DEFAULT_DAILY_LIMIT = 300;
const DEFAULT_RETRY_DELAY_MS = 2 * 60 * 1000;

export function createPublishService({ root, workDir, outputDir, readConfig, resolveConfig, clientFactory = createGeeLarkClient, outputValidator = resolveOutputPath, historyRetryDelays = [3000, 10000] }) {
  const safetyPath = path.join(workDir, "geelark-publish-safety.json");
  const recordsPath = path.join(workDir, "publish-records.json");
  const auditPath = path.join(workDir, "geelark-api-log.jsonl");
  let activeBatchId = "";

  async function publishBatch(payload, options = {}) {
    if (activeBatchId) throw new Error(`已有发布批次正在运行：${activeBatchId}`);

    const videos = Array.isArray(payload.videos) ? payload.videos : [];
    const envIds = Array.isArray(payload.envIds) ? payload.envIds.map(String).filter(Boolean) : [];
    if (!videos.length) throw new Error("请选择要发布的视频。");
    if (!envIds.length) throw new Error("请选择 GeeLark 云手机账号。");

    const batchId = String(options.batchId || payload.batchId || `publish-${Date.now()}`);
    const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? payload.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
    const autoRetry = options.autoRetry !== false && payload.autoRetry !== false;
    const manual = options.manual === true;
    const config = resolveConfig ? resolveConfig(payload.geelarkProfileId) : readConfig(root);
    const dailyLimit = clampInt(payload.dailyPublishLimit ?? config.geelarkSafety?.dailyPublishLimit, 1, DEFAULT_DAILY_LIMIT, DEFAULT_DAILY_LIMIT);
    const batchLimit = clampInt(payload.batchPublishLimit, 1, 10000, Math.max(videos.length, videos.length * 2));
    const client = clientFactory(config);
    if (!client.isConfigured()) throw new Error("GeeLark API 未配置。");

    const items = buildPublishItems(payload, videos, envIds);
    const accountMap = buildAccountMap(payload.accounts);
    const results = [];
    const retryQueue = [];
    let batchAttempts = 0;
    activeBatchId = batchId;

    try {
      options.onProgress?.({ phase: "checking", current: 0, total: items.length, message: "正在核对 GeeLark 历史任务..." });
      let remoteTasks = await readRecentTasks(client, historyRetryDelays);

      for (let index = 0; index < items.length; index++) {
        if (options.shouldStop?.()) break;
        const item = items[index];
        const result = await submitOne({
          item,
          index,
          batchId,
          payload,
          accountMap,
          client,
          remoteTasks,
          dailyLimit,
          batchLimit,
          getBatchAttempts: () => batchAttempts,
          incrementBatchAttempts: () => { batchAttempts += 1; },
          manual
        });
        results.push(result);
        if (result.retryable) retryQueue.push({ item, index });
        options.onProgress?.({
          phase: "publishing",
          current: index + 1,
          total: items.length,
          failed: results.filter((entry) => entry.status === "failed" || entry.status === "needs_check").length,
          message: result.message
        });
      }

      if (autoRetry && retryQueue.length) {
        options.onProgress?.({
          phase: "retry_wait",
          current: 0,
          total: retryQueue.length,
          retryAt: Date.now() + retryDelayMs,
          message: `${retryQueue.length} 条明确失败任务将在 2 分钟后重试一次。`
        });
        const stopped = await delayInterruptible(retryDelayMs, options.shouldStop);
        if (stopped) {
          const summary = summarize(results, batchAttempts);
          return { ok: true, batchId, stopped: true, results, summary };
        }
        remoteTasks = await readRecentTasks(client, historyRetryDelays);

        for (let retryIndex = 0; retryIndex < retryQueue.length; retryIndex++) {
          if (options.shouldStop?.()) break;
          const queued = retryQueue[retryIndex];
          const result = await submitOne({
            item: queued.item,
            index: queued.index,
            batchId,
            payload,
            accountMap,
            client,
            remoteTasks,
            dailyLimit,
            batchLimit,
            getBatchAttempts: () => batchAttempts,
            incrementBatchAttempts: () => { batchAttempts += 1; },
            manual,
            isRetry: true
          });
          const originalIndex = results.findIndex((entry) => entry.dedupeKey === result.dedupeKey);
          if (originalIndex >= 0) results[originalIndex] = result;
          options.onProgress?.({
            phase: "retrying",
            current: retryIndex + 1,
            total: retryQueue.length,
            message: result.message
          });
        }
      }

      const summary = summarize(results, batchAttempts);
      appendAudit(auditPath, { event: "batch_complete", batchId, summary });
      options.onProgress?.({ phase: "done", current: items.length, total: items.length, summary, message: "发布批次处理完成。" });
      return { ok: true, batchId, results, summary };
    } finally {
      activeBatchId = "";
    }
  }

  async function retryRecord(recordId, options = {}) {
    if (activeBatchId) throw new Error(`已有发布批次正在运行：${activeBatchId}`);
    const records = readJson(recordsPath, []);
    const record = records.find((entry) => entry.id === recordId);
    if (!record) throw new Error("没有找到待处理的发布记录。");
    if (!record.fileName || !record.assignedEnvId) throw new Error("发布记录缺少视频或账号信息。");

    const payload = {
      videos: [{
        fileName: record.fileName,
        videoUrl: record.localVideoUrl || `/outputs/${encodeURIComponent(record.fileName)}`,
        title: record.title,
        audioName: record.audioName,
        audioIndex: record.audioIndex,
        template: record.template,
        templateIndex: record.templateIndex,
        templateLabel: record.templateLabel,
        variant: record.variant
      }],
      envIds: [String(options.envId || record.assignedEnvId)],
      accounts: [{
        id: String(options.envId || record.assignedEnvId),
        name: options.accountName || record.accountName,
        serialNo: record.accountSerialNo,
        groupName: record.groupName
      }],
      videoDesc: options.videoDesc ?? record.videoDesc,
      scheduleAt: Number(options.scheduleAt) || resolveRetrySchedule(record.scheduleAt),
      intervalMinutes: 0,
      dailyPublishLimit: options.dailyPublishLimit,
      batchPublishLimit: 1,
      autoRetry: false,
      geelarkProfileId: record.geelarkProfileId || "default",
      ownerUserId: record.ownerUserId || ""
    };
    const result = await publishBatch(payload, { batchId: `manual-retry-${recordId}-${Date.now()}`, autoRetry: false, manual: true });
    if (result.results?.some((entry) => entry.status === "submitted" || entry.status === "skipped")) {
      const updated = readJson(recordsPath, []);
      const original = updated.find((entry) => entry.id === recordId);
      if (original) {
        original.status = "retried";
        original.updatedAt = Date.now();
        original.note = `manual-retry-replaced-by:${result.results[0]?.recordId || "unknown"}`;
        writeJson(recordsPath, updated);
      }
    }
    return result;
  }

  function getSafetySummary() {
    const state = readState(safetyPath);
    const day = dayKey();
    return {
      activeBatchId,
      day,
      attemptsToday: Number(state.daily?.[day]) || 0,
      scheduledToday: Number(state.daily?.[day]) || 0,
      defaultDailyLimit: DEFAULT_DAILY_LIMIT,
      uncertainCount: Object.values(state.entries || {}).filter((entry) => entry.status === "needs_check").length
    };
  }

  async function submitOne(context) {
    const {
      item, index, batchId, payload, accountMap, client, remoteTasks,
      dailyLimit, batchLimit, getBatchAttempts, incrementBatchAttempts, isRetry
    } = context;
    const account = accountMap.get(item.envId) || {};
    const state = readState(safetyPath);
    const previous = state.entries[item.dedupeKey];
    const remote = findRemoteTask(remoteTasks, item);
    const local = findLocalRecord(recordsPath, item);

    if (previous?.status === "submitted") {
      const taskIds = Array.isArray(previous.taskIds) ? previous.taskIds : [];
      const record = makeRecord({ item, index, payload, account, batchId, taskIds, resourceUrl: previous.resourceUrl || "", status: taskIds.length ? "submitted" : "needs_check", note: "skipped-safety-ledger" });
      upsertRecord(recordsPath, record);
      return taskIds.length
        ? resultFor(item, record, "skipped", "安全账本已记录该任务提交成功，已跳过重复调用。", false)
        : resultFor(item, record, "needs_check", "安全账本记录为已提交但缺少任务 ID，请人工核实。", false);
    }

    if (remote || local?.taskIds?.length) {
      const taskIds = remote?.id ? [remote.id] : local.taskIds;
      const record = makeRecord({ item, index, payload, account, batchId, taskIds, resourceUrl: local?.resourceUrl || "", status: "submitted", note: "skipped-existing-task" });
      upsertRecord(recordsPath, record);
      writeEntry(safetyPath, item.dedupeKey, { status: "submitted", taskIds, batchId, updatedAt: Date.now() });
      return resultFor(item, record, "skipped", "GeeLark 已存在相同任务，已安全跳过。", false);
    }

    if ((previous?.status === "submitting" || previous?.status === "needs_check") && !context.manual) {
      const record = makeRecord({ item, index, payload, account, batchId, status: "needs_check", note: "previous-attempt-status-uncertain" });
      upsertRecord(recordsPath, record);
      return resultFor(item, record, "needs_check", "上一次提交状态不明确，已停止自动重试。", false);
    }

    const attempts = Number(previous?.attempts) || 0;
    if (attempts >= 2 && !context.manual) {
      const record = makeRecord({ item, index, payload, account, batchId, status: "failed", note: "automatic-retry-limit-reached", attempts });
      upsertRecord(recordsPath, record);
      return resultFor(item, record, "failed", "已达到一次自动重试上限，转入人工处理。", false);
    }

    const isFirstScheduledAttempt = attempts === 0;
    const limitError = getLimitError({ state, dailyLimit, batchLimit, batchAttempts: getBatchAttempts(), scheduleAt: item.scheduleAt, checkDailyLimit: isFirstScheduledAttempt });
    if (limitError) {
      const record = makeRecord({ item, index, payload, account, batchId, status: "failed", note: `safety-limit: ${limitError}`, attempts });
      upsertRecord(recordsPath, record);
      appendAudit(auditPath, { event: "safety_limit_blocked", batchId, dedupeKey: item.dedupeKey, error: limitError });
      return resultFor(item, record, "failed", limitError, false);
    }
    incrementBatchAttempts();
    if (isFirstScheduledAttempt) incrementDailyAttempt(safetyPath, item.scheduleAt);
    const nextAttempt = attempts + 1;
    writeEntry(safetyPath, item.dedupeKey, {
      status: "submitting",
      attempts: nextAttempt,
      batchId,
      planName: item.planName,
      envId: item.envId,
      scheduleAt: item.scheduleAt,
      updatedAt: Date.now()
    });
    appendAudit(auditPath, { event: "submit_start", batchId, dedupeKey: item.dedupeKey, planName: item.planName, envId: item.envId, scheduleAt: item.scheduleAt, attempt: nextAttempt });

    let resourceUrl = "";
    try {
      const filePath = outputValidator(outputDir, item.fileName, item.video?.duration);
      const upload = await client.uploadTemporaryFile(filePath);
      resourceUrl = upload.resourceUrl;
    } catch (error) {
      const message = errorMessage(error);
      writeEntry(safetyPath, item.dedupeKey, { status: "failed", attempts: nextAttempt, batchId, phase: "upload", error: message, updatedAt: Date.now() });
      const record = makeRecord({ item, index, payload, account, batchId, resourceUrl, status: "failed", note: `upload-failed: ${message}`, attempts: nextAttempt });
      upsertRecord(recordsPath, record);
      appendAudit(auditPath, { event: "upload_failed", batchId, dedupeKey: item.dedupeKey, error: message });
      return resultFor(item, record, "failed", `上传失败：${message}`, !isRetry && nextAttempt < 2);
    }

    try {
      const task = await client.createTikTokVideoTasks({
        envIds: [item.envId],
        videoUrl: resourceUrl,
        videoDesc: payload.videoDesc || "",
        scheduleAt: item.scheduleAt,
        planName: item.planName
      });
      const taskIds = task?.taskIds || task?.data?.taskIds || [];
      if (!taskIds.length) throw new Error("GeeLark 已响应但没有返回任务 ID，已转入待核实。");
      writeEntry(safetyPath, item.dedupeKey, { status: "submitted", attempts: nextAttempt, batchId, taskIds, resourceUrl, updatedAt: Date.now() });
      const record = makeRecord({ item, index, payload, account, batchId, resourceUrl, taskIds, status: "submitted", attempts: nextAttempt });
      upsertRecord(recordsPath, record);
      appendAudit(auditPath, { event: "submit_success", batchId, dedupeKey: item.dedupeKey, taskIds });
      return resultFor(item, record, "submitted", "已提交 GeeLark。", false);
    } catch (error) {
      const message = errorMessage(error);
      const definiteFailure = error?.geelarkResponseReceived === true;
      const status = definiteFailure ? "failed" : "needs_check";
      const note = definiteFailure ? `task-add-failed: ${message}` : `task-add-uncertain: ${message}`;
      writeEntry(safetyPath, item.dedupeKey, { status, attempts: nextAttempt, batchId, phase: "task_add", resourceUrl, error: message, updatedAt: Date.now() });
      const record = makeRecord({ item, index, payload, account, batchId, resourceUrl, status, note, attempts: nextAttempt });
      upsertRecord(recordsPath, record);
      appendAudit(auditPath, { event: definiteFailure ? "submit_failed" : "submit_uncertain", batchId, dedupeKey: item.dedupeKey, error: message });
      if (definiteFailure) return resultFor(item, record, "failed", `创建任务失败：${message}`, !isRetry && nextAttempt < 2);
      return resultFor(item, record, "needs_check", `创建任务结果不明确，需核实：${message}`, false);
    }
  }

  return { publishBatch, retryRecord, getSafetySummary };
}

function buildPublishItems(payload, videos, envIds) {
  const startAt = Number(payload.scheduleAt) || Math.floor(Date.now() / 1000);
  const intervalSeconds = Math.max(0, Number(payload.intervalMinutes) || 0) * 60;
  const counts = new Map();
  return videos.map((video, index) => {
    const envId = envIds[index % envIds.length];
    const accountIndex = counts.get(envId) || 0;
    counts.set(envId, accountIndex + 1);
    const scheduleAt = startAt + accountIndex * intervalSeconds;
    const raw = video.videoUrl || video.url || video.fileName;
    const fileName = path.basename(decodeURIComponent(String(raw || "").replace(/^\/outputs\//, "")));
    if (!fileName || path.extname(fileName).toLowerCase() !== ".mp4") throw new Error(`无效视频文件：${raw || "空"}`);
    const planName = String(video.planName || payload.planName || path.basename(fileName, path.extname(fileName)));
    const dedupeKey = crypto.createHash("sha256").update(`${planName}|${envId}|${scheduleAt}`).digest("hex");
    return { video, index, envId, scheduleAt, fileName, planName, dedupeKey };
  });
}

async function readRecentTasks(client, retryDelays = [3000, 10000]) {
  const all = [];
  let lastId = "";
  for (let page = 0; page < 5; page++) {
    const data = await readHistoryPageWithRetry(client, { size: 100, lastId: lastId || undefined }, retryDelays);
    const items = Array.isArray(data?.items) ? data.items : [];
    all.push(...items);
    if (items.length < 100) break;
    const nextId = String(items[items.length - 1]?.id || "");
    if (!nextId || nextId === lastId) break;
    lastId = nextId;
  }
  return all;
}

async function readHistoryPageWithRetry(client, payload, retryDelays) {
  const delays = Array.isArray(retryDelays) ? retryDelays : [3000, 10000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.historyRecords(payload);
    } catch (error) {
      const canRetry = attempt < delays.length && isTransientHistoryError(error);
      if (!canRetry) {
        if (attempt > 0) error.message = `${error.message}（已自动重试 ${attempt} 次）`;
        throw error;
      }
      await delayInterruptible(Math.max(0, Number(delays[attempt]) || 0));
    }
  }
}

function isTransientHistoryError(error) {
  if (!error?.geelarkResponseReceived) return true;
  const status = Number(error.httpStatus) || 0;
  return status === 429 || status >= 500;
}

function findRemoteTask(tasks, item) {
  return (tasks || []).find((task) => Number(task.taskType) === 1 && String(task.planName || "") === item.planName && String(task.envId || "") === item.envId && Math.abs(Number(task.scheduleAt || 0) - item.scheduleAt) <= 60);
}

function findLocalRecord(recordsPath, item) {
  return readJson(recordsPath, []).find((record) => record.dedupeKey === item.dedupeKey || (
    path.basename(String(record.fileName || ""), path.extname(String(record.fileName || ""))) === item.planName &&
    String(record.assignedEnvId || "") === item.envId &&
    Math.abs(Number(record.scheduleAt || 0) - item.scheduleAt) <= 60
  ));
}

function makeRecord({ item, index, payload, account, batchId, resourceUrl = "", taskIds = [], status, note = "", attempts = 0 }) {
  const video = item.video || {};
  return {
    id: item.dedupeKey,
    dedupeKey: item.dedupeKey,
    batchId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: "geelark",
    geelarkProfileId: String(payload.geelarkProfileId || "default"),
    ownerUserId: String(payload.ownerUserId || ""),
    platform: "tiktok",
    status,
    attempts,
    fileName: item.fileName,
    title: video.title || "",
    audioName: video.audioName || "",
    audioIndex: Number(video.audioIndex) || 0,
    template: video.template || "reddit-mix",
    templateIndex: Number(video.templateIndex) || 0,
    templateLabel: video.templateLabel || "Reddit 混剪",
    variant: Number(video.variant) || 1,
    localVideoUrl: video.videoUrl || video.url || `/outputs/${encodeURIComponent(item.fileName)}`,
    resourceUrl,
    taskIds: Array.isArray(taskIds) ? taskIds : [],
    assignedEnvId: item.envId,
    accountName: account.name || "",
    accountSerialNo: account.serialNo || "",
    groupName: account.groupName || "",
    videoDesc: payload.videoDesc || "",
    scheduleAt: item.scheduleAt,
    intervalMinutes: Number(payload.intervalMinutes) || 0,
    shareLink: "",
    metrics: null,
    lastCheckedAt: null,
    note
  };
}

function resultFor(item, record, status, message, retryable) {
  return {
    recordId: record.id,
    dedupeKey: item.dedupeKey,
    fileName: item.fileName,
    assignedEnvId: item.envId,
    scheduleAt: item.scheduleAt,
    status,
    message,
    retryable,
    taskIds: record.taskIds || []
  };
}

function summarize(results, attempts) {
  const count = (status) => results.filter((item) => item.status === status).length;
  return {
    total: results.length,
    submitted: count("submitted"),
    skipped: count("skipped"),
    failed: count("failed"),
    needsCheck: count("needs_check"),
    apiTaskAddAttempts: attempts
  };
}

function buildAccountMap(accounts) {
  const map = new Map();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const id = String(account?.id || "");
    if (id) map.set(id, { id, name: String(account.name || ""), serialNo: String(account.serialNo || ""), groupName: String(account.groupName || "") });
  }
  return map;
}

function resolveOutputPath(outputDir, fileName, expectedDuration = 0) {
  const resolved = path.resolve(outputDir, fileName);
  if (!resolved.startsWith(path.resolve(outputDir) + path.sep) || !fs.existsSync(resolved)) throw new Error(`视频文件不存在：${fileName}`);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size < 10 * 1024) throw new Error(`视频文件无效或体积异常：${fileName}`);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type", "-of", "json", resolved], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000
  });
  if (probe.status !== 0) throw new Error(`视频无法读取：${fileName}`);
  let metadata;
  try { metadata = JSON.parse(probe.stdout || "{}"); } catch { throw new Error(`视频信息损坏：${fileName}`); }
  const streamTypes = new Set((metadata.streams || []).map((stream) => stream.codec_type));
  if (!streamTypes.has("video")) throw new Error(`视频缺少画面轨道：${fileName}`);
  if (!streamTypes.has("audio")) throw new Error(`视频缺少音频轨道：${fileName}`);
  const actualDuration = Number(metadata.format?.duration) || 0;
  if (actualDuration <= 1) throw new Error(`视频时长异常：${fileName}`);
  const expected = Number(expectedDuration) || 0;
  if (expected > 0 && Math.abs(actualDuration - expected) > Math.max(3, expected * 0.08)) {
    throw new Error(`视频时长与音频不一致：${fileName}（视频 ${actualDuration.toFixed(1)} 秒，音频 ${expected.toFixed(1)} 秒）`);
  }
  return resolved;
}

function getLimitError({ state, dailyLimit, batchLimit, batchAttempts, scheduleAt, checkDailyLimit = true }) {
  const scheduleDay = scheduleDateKey(scheduleAt);
  const scheduledCount = Number(state.daily?.[scheduleDay]) || 0;
  if (checkDailyLimit && scheduledCount >= dailyLimit) return `${scheduleDay} 已触发计划发布上限（${dailyLimit} 条），本条未调用接口。`;
  if (batchAttempts >= batchLimit) return `已触发本批 GeeLark 发布上限（${batchLimit} 次），本条未调用接口。`;
  return "";
}

function incrementDailyAttempt(filePath, scheduleAt) {
  const state = readState(filePath);
  const day = scheduleDateKey(scheduleAt);
  state.daily[day] = (Number(state.daily[day]) || 0) + 1;
  writeJson(filePath, state);
}

function writeEntry(filePath, key, patch) {
  const state = readState(filePath);
  state.entries[key] = { ...(state.entries[key] || {}), ...patch };
  writeJson(filePath, state);
}

function readState(filePath) {
  const value = readJson(filePath, {});
  return { version: 1, daily: value.daily || {}, entries: value.entries || {} };
}

function upsertRecord(filePath, record) {
  const records = readJson(filePath, []);
  const index = records.findIndex((entry) => entry.id === record.id);
  if (index >= 0) records[index] = { ...records[index], ...record };
  else records.unshift(record);
  writeJson(filePath, records);
}

function appendAudit(filePath, entry) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, "utf8");
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
  fs.renameSync(temp, filePath);
}

function resolveRetrySchedule(value) {
  const original = Number(value) || 0;
  const safeFuture = Math.floor(Date.now() / 1000) + 10 * 60;
  return original > safeFuture ? original : safeFuture;
}

function dayKey() {
  return scheduleDateKey(Math.floor(Date.now() / 1000));
}

function scheduleDateKey(value) {
  const date = new Date(Number(value) * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function errorMessage(error) {
  return String(error?.message || error || "未知错误").slice(0, 1000);
}

async function delayInterruptible(ms, shouldStop) {
  let remaining = Math.max(0, ms);
  while (remaining > 0) {
    if (shouldStop?.()) return true;
    const step = Math.min(1000, remaining);
    await new Promise((resolve) => setTimeout(resolve, step));
    remaining -= step;
  }
  return Boolean(shouldStop?.());
}
