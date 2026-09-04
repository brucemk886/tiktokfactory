import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { getPublishAccountIds, normalizePublishProvider, PUBLISH_PROVIDER_OFFICIAL } from "./publish-provider.js";
import { resolveTikTokCaption } from "./novel-video-badge.js";
import { mergeOfficialPublishRecords } from "./official-publish-records.js";
import { isOfficialPublishAbort } from "./official-publish-abort.js";
import { normalizeAssetFolders } from "./asset-library.js";
import { isParkourVideoTemplate, normalizeVideoTemplate, resolveParkourVideoDir } from "./video-template.js";
import { normalizeAudioDirs } from "./audio-library-groups.js";
import { normalizeSubtitleAnimationMode } from "./subtitle-animation.js";
import { scheduleDateKey } from "./schedule-date.js";

export { mergeOfficialPublishRecords };

// Tasks in these states still own their schedule plan: the videos are either
// waiting to render or mid-flight, so their planned slots are reserved.
const ACTIVE_TASK_STATUSES = new Set(["queued", "running"]);

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".opus", ".webm"]);
export const DEFAULT_DAILY_PLANNED_VIDEOS = 300;
const MAX_DAILY_PLANNED_VIDEOS_CAP = 100_000;

// The per-day planning cap used to be a hard-coded 300. It is now read from
// config.autoTasks.dailyPlannedLimit (or FACTORY_DAILY_PLANNED_LIMIT) so a
// 1000-account fleet can plan 3000/day without touching code.
export function resolveDailyPlannedLimit(value, fallback = DEFAULT_DAILY_PLANNED_VIDEOS) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(MAX_DAILY_PLANNED_VIDEOS_CAP, number);
}

export function createAutoTaskManager({ root, workDir, outputDir, publishService, officialPublishService, outputRetentionHours = 48, dailyPlannedLimit } = {}) {
  const MAX_DAILY_PLANNED_VIDEOS = resolveDailyPlannedLimit(process.env.FACTORY_DAILY_PLANNED_LIMIT || dailyPlannedLimit);
  const tasksDir = path.join(workDir, "scheduled-tasks");
  const generationJobsDir = path.join(workDir, "jobs");
  const retentionHours = Math.max(1, Math.min(720, Number(outputRetentionHours) || 48));
  let workerRunning = false;
  let activeTaskId = "";
  let cleanupStatus = { lastRunAt: null, deletedFiles: 0, freedBytes: 0, error: "" };
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(generationJobsDir, { recursive: true });
  recoverInterruptedTasks();
  runOutputCleanup();
  const cleanupTimer = setInterval(runOutputCleanup, 6 * 60 * 60 * 1000);
  cleanupTimer.unref?.();

  function createTask(payload) {
    validateTaskPayload(payload);
    ensureDiskSpace(workDir);
    const taskType = normalizeTaskType(payload.taskType);
    const generation = taskType === "psychology"
      ? normalizePsychologyGenerationPayload(payload.generation)
      : taskType === "schulte"
        ? normalizeSchulteGenerationPayload(payload.generation)
        : normalizeGenerationPayload(payload.generation);
    const publish = normalizePublishPayload(payload.publish, MAX_DAILY_PLANNED_VIDEOS);
    publish.geelarkProfileId = String(payload.geelarkProfileId || publish.geelarkProfileId || "default");
    publish.ownerUserId = String(payload.ownerUserId || publish.ownerUserId || "");
    const expectedVideoCount = taskType === "psychology" || taskType === "schulte"
      ? generation.totalVideos
      : generation.totalVideos || ((generation.audioItems?.length || mixAudioFileCount(generation)) * generation.variants);
    if (!expectedVideoCount) {
      throw new Error(
        taskType === "psychology"
          ? "请设置心理学视频生成数量。"
          : taskType === "schulte"
            ? "请设置舒尔特视频生成数量。"
            : "没有找到可用音频。请勾选小说平台。"
      );
    }
    const publishAccountIds = getPublishAccountIds(publish);
    const schedulePlan = publish.autoPublish
      ? buildSchedulePlan({ videoCount: expectedVideoCount, envIds: publishAccountIds, scheduleAt: publish.scheduleAt, intervalMinutes: publish.intervalMinutes })
      : [];
    validateScheduleCapacity({ plan: schedulePlan, tasks: listTasks(), dailyLimit: MAX_DAILY_PLANNED_VIDEOS });
    const id = safeId(`auto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const now = Date.now();
    const task = {
      id,
      taskType,
      name: String(payload.name || `自动任务 ${new Date(now).toLocaleString("zh-CN")}`).slice(0, 120),
      status: "queued",
      phase: "queued",
      message: "任务已加入队列。",
      progress: { current: 0, total: 0, percent: 0 },
      generation,
      publish,
      ownerUserId: String(payload.ownerUserId || ""),
      geelarkProfileId: String(payload.geelarkProfileId || publish.geelarkProfileId || "default"),
      expectedVideoCount,
      schedulePlan,
      generatedVideos: [],
      publishResults: [],
      generationJobId: "",
      error: "",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null
    };
    writeTask(task);
    kick();
    return task;
  }

  function listTasks({ includeDeleted = false } = {}) {
    return fs.readdirSync(tasksDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readTask(path.basename(entry.name, ".json")))
      .filter(Boolean)
      .filter((task) => includeDeleted || Number(task.deleted) !== 1)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  function getTask(id) {
    const task = readTask(safeId(id));
    if (!task) throw new Error("自动任务不存在。");
    return task;
  }

  function cancelTask(id) {
    const task = getTask(id);
    const generationJobId = safeId(task.generationJobId);
    if (generationJobId && generationJobId !== "task") {
      const jobPath = path.join(generationJobsDir, `${generationJobId}.json`);
      const job = readJson(jobPath, {});
      writeJson(jobPath, { ...job, jobId: generationJobId, status: "canceled", message: "任务已停止。", updatedAt: Date.now() });
    }
    patchTask(task.id, {
      status: "canceled",
      phase: "canceled",
      message: "任务已停止。已提交到 GeeLark 的任务不会被撤销。",
      workerPid: null,
      updatedAt: Date.now()
    });
    if (task.workerPid) killProcessTree(task.workerPid);
    return getTask(task.id);
  }

  function archiveTask(id, deletedBy = "") {
    const task = getTask(id);
    const activePhases = new Set(["generating", "publishing", "checking", "retry_wait", "retrying"]);
    if (["queued", "running"].includes(task.status) || activePhases.has(task.phase)) {
      throw new Error("任务正在执行中，请先停止或等待完成后再隐藏。");
    }
    if (Number(task.deleted) === 1) return task;
    patchTask(task.id, { deleted: 1, deletedAt: Date.now(), deletedBy: String(deletedBy || ""), updatedAt: Date.now() });
    return getTask(task.id);
  }

  function renameTask(id, name) {
    const task = getTask(id);
    const nextName = String(name || "").trim().replace(/\s+/g, " ").slice(0, 120);
    if (!nextName) throw new Error("任务名称不能为空。");
    patchTask(task.id, { name: nextName, updatedAt: Date.now() });
    return getTask(task.id);
  }

  function resumeTask(id) {
    const task = getTask(id);
    if (!["failed", "paused", "awaiting_review"].includes(task.status)) throw new Error("当前任务状态不能继续执行。");
    const publish = task.status === "awaiting_review" ? { ...task.publish, autoPublish: true } : task.publish;
    const schedulePlan = getTaskSchedulePlan({ ...task, publish });
    validateScheduleCapacity({ plan: schedulePlan, tasks: listTasks(), dailyLimit: MAX_DAILY_PLANNED_VIDEOS, excludeTaskId: task.id });
    patchTask(task.id, { status: "queued", phase: "queued", publish, schedulePlan, error: "", message: "任务已重新加入队列。", updatedAt: Date.now() });
    kick();
    return getTask(task.id);
  }

  async function retryPublishRecord(taskId, recordId, options = {}) {
    const task = getTask(taskId);
    if (task.publish?.provider === PUBLISH_PROVIDER_OFFICIAL) {
      throw Object.assign(new Error("TikTok 官方 API 任务暂不支持单条人工重试，请重新创建发布任务。"), { statusCode: 400 });
    }
    patchTask(task.id, { message: "正在人工重试发布...", updatedAt: Date.now() });
    try {
      const result = await publishService.retryRecord(recordId, options);
      const remaining = (task.publishResults || []).filter((item) => item.recordId !== recordId);
      const merged = mergePublishResults(remaining, result.results || []);
      const hasPending = merged.some((item) => item.status === "failed" || item.status === "needs_check");
      patchTask(task.id, {
        publishResults: merged,
        status: hasPending ? task.status : "done",
        phase: hasPending ? task.phase : "done",
        completedAt: hasPending ? task.completedAt : Date.now(),
        message: hasPending ? "人工重试完成，仍有任务需要处理。" : "人工重试完成，任务已全部发布。",
        updatedAt: Date.now()
      });
      return result;
    } catch (error) {
      patchTask(task.id, { message: `人工重试失败：${error.message}`, updatedAt: Date.now() });
      throw error;
    }
  }

  function kick() {
    if (workerRunning) return;
    setTimeout(runQueue, 0);
  }

  async function runQueue() {
    if (workerRunning) return;
    workerRunning = true;
    try {
      while (true) {
        const next = listTasks().filter((task) => task.status === "queued" && task.source !== "factory-cloud").sort((a, b) => {
          const scheduleDifference = Number(a.publish?.scheduleAt || 0) - Number(b.publish?.scheduleAt || 0);
          return scheduleDifference || Number(a.createdAt) - Number(b.createdAt);
        })[0];
        if (!next) break;
        activeTaskId = next.id;
        await runTask(next.id);
        activeTaskId = "";
      }
    } finally {
      workerRunning = false;
      activeTaskId = "";
    }
  }

  async function runTask(id) {
    let task = getTask(id);
    patchTask(id, { status: "running", startedAt: task.startedAt || Date.now(), error: "", updatedAt: Date.now() });
    try {
      if (!task.generationCompletedAt) {
        const generation = await runGeneration(task);
        task = getTask(id);
        if (task.status === "canceled") return;
        if (generation.status !== "done") throw new Error(generation.message || "视频生成失败。");
        const videos = validateGeneratedVideos(generation.results || []);
        patchTask(id, {
          generatedVideos: videos,
          generationCompletedAt: Date.now(),
          workerPid: null,
          message: `视频生成完成，共 ${videos.length} 条。`,
          updatedAt: Date.now()
        });
      }

      task = getTask(id);
      if (["canceled", "cancelled"].includes(String(task.status || ""))) {
        patchTask(id, { status: "canceled", phase: "canceled", message: "任务已停止。", workerPid: null, updatedAt: Date.now() });
        return;
      }
      if (!task.publish.autoPublish) {
        patchTask(id, { status: "awaiting_review", phase: "awaiting_review", message: "视频已生成，等待人工确认发布。", updatedAt: Date.now() });
        return;
      }

      const isOfficial = task.publish.provider === PUBLISH_PROVIDER_OFFICIAL;
      patchTask(id, { phase: "publishing", message: isOfficial ? "正在提交到 TikTok 官方 API..." : "正在安全提交到 GeeLark...", updatedAt: Date.now() });
      let result;
      if (isOfficial) {
        if (typeof officialPublishService !== "function") throw new Error("TikTok 官方 API 发布服务未配置。");
        let officialResult;
        try {
          officialResult = await officialPublishService({
            ...task.publish,
            videos: task.generatedVideos,
            name: task.name,
            taskId: task.id,
            officialWaveSize: 10,
            officialUploadConcurrency: 10,
            checkpoint: task.officialPublishCheckpoint,
            shouldAbort: () => ["canceled", "cancelled"].includes(String(readTask(id)?.status || "")),
            onCheckpoint: (next) => {
              if (["canceled", "cancelled"].includes(String(readTask(id)?.status || ""))) return;
              patchTask(id, { officialPublishCheckpoint: next, updatedAt: Date.now() });
            },
            onProgress: (progress) => {
              if (["canceled", "cancelled"].includes(String(readTask(id)?.status || ""))) return;
              const total = Math.max(1, Number(progress?.total) || task.generatedVideos?.length || 1);
              const current = Math.max(0, Number(progress?.current) || 0);
              patchTask(id, {
                phase: "publishing",
                message: progress?.message || "正在提交到 TikTok 官方 API...",
                publishProgress: {
                  current,
                  total,
                  percent: Math.max(0, Math.min(99, Math.round(current / total * 100)))
                },
                updatedAt: Date.now()
              });
            }
          });
        } catch (error) {
          if (isOfficialPublishAbort(error) || ["canceled", "cancelled"].includes(String(readTask(id)?.status || ""))) {
            patchTask(id, { status: "canceled", phase: "canceled", message: "任务已停止。", workerPid: null, updatedAt: Date.now() });
            return;
          }
          throw error;
        }
        if (["canceled", "cancelled"].includes(String(readTask(id)?.status || ""))) {
          patchTask(id, { status: "canceled", phase: "canceled", message: "任务已停止。", workerPid: null, updatedAt: Date.now() });
          return;
        }
        result = normalizeOfficialAutoPublishResult(task, officialResult);
        try {
          persistOfficialPublishRecords(workDir, task, result.results);
        } catch (error) {
          result.recordPersistenceError = String(error?.message || error);
        }
        if (result.recordPersistenceError) {
          patchTask(id, {
            status: "needs_attention",
            phase: "needs_attention",
            publishResults: result.results,
            publishSummary: result.summary,
            publishRecordError: result.recordPersistenceError,
            message: `TikTok 官方任务已提交，但本地记录保存失败，请人工核实：${result.recordPersistenceError}`,
            completedAt: Date.now(),
            updatedAt: Date.now()
          });
          return;
        }
        patchTask(id, {
          status: "done",
          phase: "done",
          publishResults: result.results,
          publishSummary: result.summary,
          officialBatchIds: collectOfficialBatchIds(result.results),
          officialSubmittedAt: Date.now(),
          officialStatusFinalizedAt: Date.now(),
          message: "已提交发布中台。后续排期、TikTok 发布确认和失败处理请在线上 Signal Desk 查看。",
          completedAt: Date.now(),
          updatedAt: Date.now()
        });
        return;
      } else {
        result = await publishService.publishBatch({
          ...task.publish,
          videos: task.generatedVideos,
          batchId: task.id,
          autoRetry: true,
          retryDelayMs: 2 * 60 * 1000
        }, {
          batchId: task.id,
          retryDelayMs: 2 * 60 * 1000,
          autoRetry: true,
          onProgress: (progress) => {
            const {
              results: progressResults,
              summary: progressSummary,
              ...publishProgress
            } = progress;
            patchTask(id, {
              phase: progress.phase,
              message: progress.message,
              publishProgress,
              ...(Array.isArray(progressResults) ? { publishResults: progressResults } : {}),
              ...(progressSummary ? { publishSummary: progressSummary } : {}),
              updatedAt: Date.now()
            });
          },
          shouldStop: () => readTask(id)?.status === "canceled"
        });
      }
      if (getTask(id).status === "canceled") return;
      const hasManual = Boolean(result.recordPersistenceError)
        || result.results.some((item) => item.status === "failed" || item.status === "needs_check");
      patchTask(id, {
        status: hasManual ? "needs_attention" : "done",
        phase: hasManual ? "needs_attention" : "done",
        publishResults: result.results,
        publishSummary: result.summary,
        publishRecordError: result.recordPersistenceError || "",
        message: result.recordPersistenceError
          ? `TikTok 官方 API 已提交，但发布记录保存失败，请人工核实：${result.recordPersistenceError}`
          : hasManual ? "主任务已完成，部分发布需要人工处理。" : "生成和发布任务全部完成。",
        completedAt: Date.now(),
        updatedAt: Date.now()
      });
    } catch (error) {
      const current = getTask(id);
      if (current.status === "canceled") return;
      patchTask(id, {
        status: "failed",
        phase: "failed",
        error: String(error?.message || error),
        message: `任务失败：${error?.message || error}`,
        workerPid: null,
        updatedAt: Date.now()
      });
    }
  }

  function runGeneration(task) {
    return new Promise((resolve, reject) => {
      const taskType = normalizeTaskType(task.taskType);
      const jobId = safeId(`auto-${taskType}-${task.id}-${Date.now()}`);
      const payloadPath = path.join(generationJobsDir, `${jobId}.payload.json`);
      const jobPath = path.join(generationJobsDir, `${jobId}.json`);
      fs.writeFileSync(payloadPath, JSON.stringify({
        ...task.generation,
        jobId,
        burnNovelBadge: normalizePublishProvider(task.publish?.provider) === PUBLISH_PROVIDER_OFFICIAL
      }, null, 2), "utf8");
      fs.writeFileSync(jobPath, JSON.stringify({ jobId, status: "queued", percent: 1, message: "自动任务开始生成。", createdAt: Date.now() }, null, 2), "utf8");
      const generatorScript = taskType === "psychology"
        ? "psychology-video-job.js"
        : taskType === "schulte"
          ? "schulte-batch-job.js"
          : "reddit-mix-job.js";
      const child = spawn(process.execPath, [path.join(root, "scripts", generatorScript), payloadPath, jobPath], {
        cwd: root,
        detached: false,
        stdio: "ignore",
        windowsHide: true
      });
      patchTask(task.id, { phase: "generating", generationJobId: jobId, workerPid: child.pid, message: "正在生成视频...", updatedAt: Date.now() });

      let settled = false;
      const timer = setInterval(() => {
        try {
          const currentTask = getTask(task.id);
          if (currentTask.status === "canceled") {
            clearInterval(timer);
            settled = true;
            resolve({ status: "canceled", results: [] });
            return;
          }
          const job = readJson(jobPath, null);
          if (!job) return;
          patchTask(task.id, {
            phase: "generating",
            message: job.message || "正在生成视频...",
            progress: { current: Number(job.progressCurrent) || 0, total: Number(job.progressTotal) || 0, percent: Number(job.percent) || 0 },
            generatedVideos: Array.isArray(job.results) ? job.results : currentTask.generatedVideos,
            generationWarnings: Array.isArray(job.warnings) ? job.warnings : (currentTask.generationWarnings || []),
            failedVideoCount: Number(job.failedVideoCount) || 0,
            generationAttempts: Number(job.attempts) || 0,
            updatedAt: Date.now()
          });
          if (["done", "failed", "canceled"].includes(job.status)) {
            clearInterval(timer);
            settled = true;
            resolve(job);
          }
        } catch (error) {
          clearInterval(timer);
          settled = true;
          reject(error);
        }
      }, 1500);

      child.on("error", (error) => {
        if (settled) return;
        clearInterval(timer);
        settled = true;
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        setTimeout(() => {
          if (settled) return;
          const job = readJson(jobPath, null);
          if (job && ["done", "failed", "canceled"].includes(job.status)) {
            clearInterval(timer);
            settled = true;
            resolve(job);
            return;
          }
          clearInterval(timer);
          settled = true;
          reject(new Error(`视频生成进程意外退出（退出码 ${code ?? "未知"}${signal ? `，信号 ${signal}` : ""}），任务已停止，未进入发布阶段。`));
        }, 750);
      });
    });
  }

  function recoverInterruptedTasks() {
    let recovered = false;
    for (const task of listTasks()) {
      if (!["running", "generating", "publishing", "checking", "retry_wait", "retrying"].includes(task.status) && !["generating", "publishing", "checking", "retry_wait", "retrying"].includes(task.phase)) continue;
      if (task.source === "factory-cloud") {
        patchTask(task.id, { workerPid: null, updatedAt: Date.now() });
        continue;
      }
      if (task?.publish?.provider === PUBLISH_PROVIDER_OFFICIAL && collectOfficialBatchIds(task.publishResults, task.officialBatchIds).length) {
        const results = markOfficialResultsHandedOff(task.publishResults);
        patchTask(task.id, {
          status: "done",
          phase: "done",
          workerPid: null,
          publishResults: results,
          publishSummary: summarizeOfficialResults(results),
          officialStatusFinalizedAt: Date.now(),
          message: "已提交发布中台。后续状态请在线上 Signal Desk 查看。",
          completedAt: task.completedAt || Date.now(),
          updatedAt: Date.now()
        });
        continue;
      }
      recovered = true;
      const generationJobPath = task.generationJobId ? path.join(generationJobsDir, `${safeId(task.generationJobId)}.json`) : "";
      const generationJob = generationJobPath ? readJson(generationJobPath, null) : null;
      const generationFinished = generationJob?.status === "done" && Array.isArray(generationJob.results) && generationJob.results.length > 0;
      patchTask(task.id, {
        status: "queued",
        phase: "queued",
        workerPid: null,
        generatedVideos: generationFinished ? validateGeneratedVideos(generationJob.results) : (task.generationCompletedAt ? task.generatedVideos : []),
        generationCompletedAt: generationFinished ? Date.now() : task.generationCompletedAt,
        message: "服务重启后已恢复到任务队列；发布安全层会先核对远端记录。",
        updatedAt: Date.now()
      });
    }
    if (recovered) kick();
  }

  function validateGeneratedVideos(results) {
    const valid = [];
    for (const item of results) {
      const fileName = path.basename(String(item.fileName || decodeURIComponent(String(item.videoUrl || "").split("/").pop() || "")));
      if (!fileName) continue;
      const psychology = item.template === "psychology-static";
      const schulte = [
        "schulte-wheel",
        "schulte-tracking",
        "schulte-memory",
        "schulte-peripheral"
      ].includes(item.template);
      valid.push({
        ...item,
        fileName,
        videoUrl: item.videoUrl || `/outputs/${encodeURIComponent(fileName)}`,
        template: item.template || "reddit-mix",
        templateLabel: item.templateLabel || (
          psychology
            ? "心理学测试"
            : schulte
              ? ({
                  "schulte-wheel": "舒尔特模板 1",
                  "schulte-tracking": "舒尔特模板 2",
                  "schulte-memory": "舒尔特模板 4",
                  "schulte-peripheral": "舒尔特模板 5"
                })[item.template] || "舒尔特训练"
              : "Reddit 混剪"
        )
      });
    }
    if (!valid.length) throw new Error("生成任务没有产生可发布的视频。");
    return valid;
  }

  function readTask(id) {
    return readJson(path.join(tasksDir, `${safeId(id)}.json`), null);
  }

  function writeTask(task) {
    writeJson(path.join(tasksDir, `${safeId(task.id)}.json`), task);
  }

  function patchTask(id, patch) {
    const task = readTask(id);
    if (!task) return;
    if (task.status === "canceled" && patch.status !== "queued" && patch.status !== "canceled") {
      return task;
    }
    writeTask({ ...task, ...patch });
  }

  function mirrorExternalTask(patch = {}) {
    const id = safeId(patch.id);
    if (!id) return null;
    const current = readTask(id) || {};
    if (current.id && current.source !== "factory-cloud") return current;
    if (["canceled", "cancelled"].includes(String(current.status || ""))
      && !["queued", "canceled", "cancelled"].includes(String(patch.status || ""))) {
      return current;
    }
    const next = {
      ...current,
      ...patch,
      id,
      source: "factory-cloud",
      updatedAt: Date.now()
    };
    writeTask(next);
    return next;
  }

  function runOutputCleanup() {
    const now = Date.now();
    const cutoff = now - retentionHours * 60 * 60 * 1000;
    let deletedFiles = 0;
    let freedBytes = 0;
    try {
      if (!outputDir) throw new Error("未配置成片输出目录。");
      const outputRoot = path.resolve(outputDir);
      const tasks = listTasks();
      const protectedNames = new Set(tasks
        .filter((task) => taskStillNeedsOutputFiles(task))
        .flatMap((task) => task.generatedVideos || [])
        .map((video) => path.basename(String(video.fileName || "")))
        .filter(Boolean));

      for (const task of tasks) {
        const completedAt = Number(task.completedAt) || 0;
        const results = Array.isArray(task.publishResults) ? task.publishResults : [];
        const safelyPublished = results.length > 0 && results.every((item) => item.status === "submitted" || item.status === "skipped");
        const latestScheduleAt = Math.max(0, ...results.map((item) => Number(item.scheduleAt) * 1000 || 0));
        const retentionStart = Math.max(completedAt, latestScheduleAt);
        if (task.status !== "done" || !safelyPublished || !retentionStart || retentionStart > cutoff) continue;

        let taskDeleted = 0;
        const generatedVideos = (task.generatedVideos || []).map((video) => {
          const fileName = path.basename(String(video.fileName || ""));
          if (!fileName || protectedNames.has(fileName) || video.outputDeletedAt) return video;
          const filePath = path.resolve(outputRoot, fileName);
          if (!filePath.startsWith(`${outputRoot}${path.sep}`)) return video;
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            fs.rmSync(filePath);
            deletedFiles += 1;
            taskDeleted += 1;
            freedBytes += stat.size;
          }
          return { ...video, outputDeletedAt: now };
        });
        if (taskDeleted > 0) patchTask(task.id, { generatedVideos, outputCleanedAt: now, outputCleanupCount: (Number(task.outputCleanupCount) || 0) + taskDeleted, updatedAt: now });
      }

      const records = readJson(path.join(workDir, "publish-records.json"), []);
      const recordsByFile = new Map();
      for (const record of Array.isArray(records) ? records : []) {
        const fileName = path.basename(String(record.fileName || ""));
        if (!fileName) continue;
        if (!recordsByFile.has(fileName)) recordsByFile.set(fileName, []);
        recordsByFile.get(fileName).push(record);
      }
      for (const [fileName, fileRecords] of recordsByFile) {
        if (protectedNames.has(fileName)) continue;
        const safelyPublished = fileRecords.length > 0 && fileRecords.every((record) => record.status === "submitted" || record.status === "retried");
        const retentionStart = Math.max(0, ...fileRecords.map((record) => Math.max(Number(record.updatedAt) || 0, (Number(record.scheduleAt) || 0) * 1000)));
        if (!safelyPublished || !retentionStart || retentionStart > cutoff) continue;
        const filePath = path.resolve(outputRoot, fileName);
        if (!filePath.startsWith(`${outputRoot}${path.sep}`) || !fs.existsSync(filePath)) continue;
        const stat = fs.statSync(filePath);
        fs.rmSync(filePath);
        deletedFiles += 1;
        freedBytes += stat.size;
      }
      cleanupStatus = { lastRunAt: now, deletedFiles, freedBytes, error: "" };
    } catch (error) {
      cleanupStatus = { lastRunAt: now, deletedFiles, freedBytes, error: String(error?.message || error) };
    }
    return cleanupStatus;
  }

  return { createTask, listTasks, getTask, cancelTask, archiveTask, renameTask, resumeTask, retryPublishRecord, runOutputCleanup, mirrorExternalTask, getStatus: () => ({ workerRunning, activeTaskId, retentionHours, cleanup: cleanupStatus }) };
}

function validateTaskPayload(payload) {
  const generation = payload?.generation || {};
  const publish = payload?.publish || {};
  if (payload?.taskType === "psychology") {
    if (!String(generation.question || "").trim()) throw new Error("请输入心理学测试题目。");
    if (!String(generation.elevenLabsVoiceId || "").trim()) throw new Error("请配置 ElevenLabs Voice ID。");
    if (publish.autoPublish !== false && !getPublishAccountIds(publish).length) throw new Error("请选择至少一个发布账号。");
    const scheduleAt = Number(publish.scheduleAt);
    if (publish.autoPublish !== false && (!Number.isFinite(scheduleAt) || scheduleAt < Math.floor(Date.now() / 1000) + 300)) throw new Error("自动发布的起始时间至少需要晚于当前时间 5 分钟。");
    return;
  }
  if (payload?.taskType === "schulte") {
    if (!["wheel", "tracking", "memory", "peripheral"].includes(generation.template)) throw new Error("请选择舒尔特训练模板。");
    if (!(Number(generation.totalVideos) >= 1)) throw new Error("舒尔特视频生成数量至少为 1 条。");
    if (publish.autoPublish !== false && !getPublishAccountIds(publish).length) throw new Error("请选择至少一个发布账号。");
    const scheduleAt = Number(publish.scheduleAt);
    if (publish.autoPublish !== false && (!Number.isFinite(scheduleAt) || scheduleAt < Math.floor(Date.now() / 1000) + 300)) throw new Error("自动发布的起始时间至少需要晚于当前时间 5 分钟。");
    return;
  }
  if (isParkourVideoTemplate(generation)) {
    if (!String(generation.videoDir || "").trim()) throw new Error("请选择跑酷视频目录。");
  } else if (!String(generation.assetGroupId || "").trim() && !String(generation.videoDir || "").trim()) {
    throw new Error("请选择素材组或视频素材目录。");
  }
  if (!String(generation.audioDir || "").trim() && !normalizeAudioDirs(generation.audioDirs).length && !normalizeAudioItems(generation.audioItems).length) {
    throw new Error("请勾选小说平台。");
  }
  if (publish.autoPublish !== false && !getPublishAccountIds(publish).length) throw new Error("请选择至少一个发布账号。");
  const scheduleAt = Number(publish.scheduleAt);
  if (publish.autoPublish !== false && (!Number.isFinite(scheduleAt) || scheduleAt < Math.floor(Date.now() / 1000) + 300)) throw new Error("自动发布的起始时间至少需要晚于当前时间 5 分钟。");
}

function normalizeTaskType(value) {
  if (value === "psychology") return "psychology";
  if (value === "schulte") return "schulte";
  return "reddit";
}

function normalizePsychologyGenerationPayload(value = {}) {
  const imageModels = Array.isArray(value.imageModels)
    ? value.imageModels.filter((model) => model === "grok" || model === "nano-banana")
    : [];
  return {
    question: String(value.question || "").trim(),
    hookTitle: String(value.hookTitle || value.question || "").trim().slice(0, 160),
    sourceImageUrl: String(value.sourceImageUrl || "").trim(),
    fallbackImageUrl: String(value.fallbackImageUrl || value.sourceImageUrl || "").trim(),
    answerGuide: String(value.answerGuide || "").trim(),
    narration: String(value.narration || "").trim(),
    imagePrompt: String(value.imagePrompt || "").trim(),
    creativeVariant: Math.max(1, Math.min(100000, Math.floor(Number(value.creativeVariant) || 1))),
    imageModels: imageModels.length ? imageModels : ["nano-banana"],
    variantsPerModel: Math.max(1, Math.min(10, Math.floor(Number(value.variantsPerModel) || 1))),
    totalVideos: Math.max(1, Math.min(300, Math.floor(Number(value.totalVideos) || imageModels.length || 1))),
    aspectRatio: value.aspectRatio === "9:16" ? "9:16" : "16:9",
    durationSeconds: Math.max(8, Math.min(30, Number(value.durationSeconds) || 12)),
    titlePosition: Math.max(8, Math.min(55, Number(value.titlePosition) || 14)),
    titleFontSize: Math.max(42, Math.min(100, Number(value.titleFontSize) || 68)),
    motion: ["none", "slow-zoom", "test-motion"].includes(value.motion) ? value.motion : "test-motion",
    backgroundMusicDir: String(value.backgroundMusicDir || "").trim(),
    backgroundMusicVolume: Math.max(0, Math.min(0.5, Number(value.backgroundMusicVolume) || 0.10)),
    autoGenerateNarration: value.autoGenerateNarration !== false,
    elevenLabsVoiceId: String(value.elevenLabsVoiceId || "").trim(),
    elevenLabsModelId: String(value.elevenLabsModelId || "eleven_multilingual_v2").trim(),
    elevenLabsOutputFormat: String(value.elevenLabsOutputFormat || "mp3_44100_128").trim()
  };
}

function normalizeSchulteGenerationPayload(value = {}) {
  const allowedTemplates = ["wheel", "tracking", "memory", "peripheral"];
  const templates = Array.from(new Set(
    (Array.isArray(value.templates) ? value.templates : [value.template])
      .filter((template) => allowedTemplates.includes(template))
  ));
  const template = templates[0] || "wheel";
  const trackingSeconds = Math.max(10, Math.min(90, Math.round(Number(value.trackingSeconds) || 30)));
  const durationSeconds = template === "tracking"
    ? trackingSeconds + 7
    : ["memory", "peripheral"].includes(template)
      ? Math.max(12, Math.min(90, Math.round(Number(value.durationSeconds) || (template === "memory" ? 32 : 18))))
    : Math.max(12, Math.min(180, Math.round(Number(value.durationSeconds) || 32)));
  const trainingStartsAt = Math.max(3, Math.min(
    Math.max(3, durationSeconds - 2),
    Number(value.trainingStartsAt) || 4
  ));
  const instructionStartsAt = Math.max(1, Math.min(
    Math.max(1, trainingStartsAt - 0.5),
    Number(value.instructionStartsAt) || 2
  ));
  return {
    template,
    templates: templates.length ? templates : [template],
    totalVideos: Math.max(1, Math.min(300, Math.floor(Number(value.totalVideos) || 1))),
    startDay: Math.max(1, Math.min(999, Math.floor(Number(value.startDay ?? value.day) || (template === "tracking" ? 46 : 24)))),
    seed: Math.max(1, Math.min(999999, Math.floor(Number(value.seed) || (template === "tracking" ? 4602 : 2407)))),
    wheelDurationSeconds: Math.max(12, Math.min(180, Math.round(Number(value.wheelDurationSeconds ?? value.durationSeconds) || 32))),
    durationSeconds,
    trainingStartsAt,
    instructionStartsAt,
    rotationSpeed: Math.max(0.25, Math.min(3, Number(value.rotationSpeed) || 2.5)),
    trainingMode: ["auto", "sequence", "reverse", "missing", "duplicate"].includes(value.trainingMode)
      ? value.trainingMode
      : "auto",
    layoutStyle: ["auto", "classic", "balanced", "focus"].includes(value.layoutStyle)
      ? value.layoutStyle
      : "auto",
    backgroundStyle: ["auto", "mint", "sky", "lavender", "peach", "paper"].includes(value.backgroundStyle)
      ? value.backgroundStyle
      : "auto",
    instructionLanguage: value.instructionLanguage === "en" ? "en" : "zh",
    trackingSeconds,
    ballSpeed: Math.max(0.5, Math.min(3, Number(value.ballSpeed) || 1)),
    trackingMode: ["auto", "single", "dual", "triple"].includes(value.trackingMode)
      ? value.trackingMode
      : "auto",
    trackingBackground: ["auto", "forest", "navy", "violet", "graphite", "amber"].includes(value.trackingBackground)
      ? value.trackingBackground
      : "auto",
    memorySteps: Math.max(4, Math.min(8, Math.round(Number(value.memorySteps) || 6))),
    memoryBackground: ["auto", "aqua", "navy", "violet", "forest", "sunset", "rose", "graphite"].includes(value.memoryBackground)
      ? value.memoryBackground
      : "auto",
    peripheralTargets: Math.max(2, Math.min(5, Math.round(Number(value.peripheralTargets) || 3))),
    headline: String(value.headline || (template === "tracking" ? "每日前额叶训练" : "专注力改造计划")).trim().slice(0, 24),
    mainTitle: String(value.mainTitle || "每日前额叶训练").trim().slice(0, 24),
    backgroundMusicMode: ["local", "built-in", "off"].includes(value.backgroundMusicMode)
      ? value.backgroundMusicMode
      : (String(value.backgroundMusicDir || "").trim() ? "local" : (value.backgroundMusicEnabled === false ? "off" : "built-in")),
    backgroundMusicEnabled: value.backgroundMusicEnabled !== false,
    backgroundMusicDir: String(value.backgroundMusicDir || "").trim(),
    backgroundMusicVolume: Math.max(
      0,
      Math.min(1, Number.isFinite(Number(value.backgroundMusicVolume)) ? Number(value.backgroundMusicVolume) : 0.35)
    )
  };
}

function normalizeGenerationPayload(value = {}) {
  const videoTemplate = normalizeVideoTemplate(value.videoTemplate);
  const videoDir = videoTemplate === "parkour"
    ? resolveParkourVideoDir(value.videoDir)
    : String(value.videoDir || "");
  return {
    videoTemplate,
    videoDir,
    includeVideoSubfolders: value.includeVideoSubfolders !== false,
    audioDir: String(value.audioDir || ""),
    audioDirs: normalizeAudioDirs(value.audioDirs, value.audioDir),
    audioItems: normalizeAudioItems(value.audioItems),
    audioPriority: Array.isArray(value.audioPriority)
      ? value.audioPriority.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 300)
      : [],
    audioPriorityMode: String(value.audioPriorityMode || ""),
    audioOffset: Math.max(0, Math.floor(Number(value.audioOffset) || 0)),
    backgroundMusicDir: String(value.backgroundMusicDir || ""),
    backgroundMusicVolume: Number(value.backgroundMusicVolume) || 0.12,
    saveDir: String(value.saveDir || ""),
    assetGroupId: String(value.assetGroupId || ""),
    assetFolders: videoTemplate === "parkour" ? [] : normalizeAssetFolders(value.assetFolders),
    segmentMode: value.segmentMode === "ratio" ? "ratio" : "fixed",
    segmentSeconds: Number(value.segmentSeconds) || 5,
    segmentRatio: Number(value.segmentRatio) || 10,
    variants: Math.max(1, Math.min(20, Number(value.variants) || 1)),
    totalVideos: Math.max(0, Math.min(300, Math.floor(Number(value.totalVideos) || 0))),
    subtitleYPercent: Number(value.subtitleYPercent) || 66,
    subtitleFontSize: Number(value.subtitleFontSize) || 62,
    subtitleAnimationMode: normalizeSubtitleAnimationMode(value.subtitleAnimationMode),
    quality: value.quality === "quality" ? "quality" : "fast",
    autoCaptions: value.autoCaptions !== false,
    openingTitleEnabled: value.openingTitleEnabled === true,
    endCardEnabled: value.endCardEnabled !== false,
    novelId: String(value.novelId || "").trim(),
    novelPlatform: String(value.novelPlatform || value.platform || "").trim(),
    novelPromotionCode: String(value.novelPromotionCode || value.promotionCode || "").trim(),
    novelBookId: String(value.novelBookId || value.bookId || "").trim(),
    dedup: value.dedup && typeof value.dedup === "object" ? value.dedup : { enabled: true }
  };
}

function ensureDiskSpace(directory, minimumFreeBytes = 20 * 1024 ** 3) {
  if (typeof fs.statfsSync !== "function") return;
  const stats = fs.statfsSync(directory);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  if (Number.isFinite(freeBytes) && freeBytes < minimumFreeBytes) {
    throw new Error(`任务磁盘剩余空间不足 20 GB（当前约 ${(freeBytes / 1024 ** 3).toFixed(1)} GB），请清理后再创建任务。`);
  }
}

function normalizePublishPayload(value = {}, dailyPublishLimit = DEFAULT_DAILY_PLANNED_VIDEOS) {
  return {
    provider: normalizePublishProvider(value.provider),
    autoPublish: value.autoPublish !== false,
    envIds: Array.isArray(value.envIds) ? value.envIds.map(String).filter(Boolean) : [],
    accounts: Array.isArray(value.accounts) ? value.accounts : [],
    connectionIds: Array.isArray(value.connectionIds) ? value.connectionIds.map(String).filter(Boolean) : [],
    officialAccounts: Array.isArray(value.officialAccounts) ? value.officialAccounts : [],
    accountAssignment: resolveOfficialAccountAssignment(value.accountAssignment),
    captionMode: String(value.captionMode || "").trim().toLowerCase() === "manual" ? "manual" : "auto",
    videoDesc: String(value.videoDesc || ""),
    scheduleAt: Number(value.scheduleAt) || Math.floor(Date.now() / 1000),
    intervalMinutes: Math.max(0, Number(value.intervalMinutes) || 0),
    dailyPublishLimit,
    batchPublishLimit: Math.max(1, Number(value.batchPublishLimit) || 300),
    geelarkProfileId: String(value.geelarkProfileId || "default"),
    ownerUserId: String(value.ownerUserId || ""),
    operationMeta: normalizeOperationMeta(value.operationMeta)
  };
}

function normalizeOperationMeta(value = {}) {
  if (!value || typeof value !== "object") return null;
  return {
    createdBy: String(value.createdBy || ""),
    createdAt: Number(value.createdAt) || 0,
    planDate: String(value.planDate || ""),
    objective: String(value.objective || ""),
    recipeId: String(value.recipeId || ""),
    contentVariantId: String(value.contentVariantId || ""),
    targetStages: Array.isArray(value.targetStages)
      ? Array.from(new Set(value.targetStages.map(String).filter(Boolean)))
      : []
  };
}

export function buildSchedulePlan({ videoCount, envIds, scheduleAt, intervalMinutes }) {
  const accounts = Array.isArray(envIds) ? envIds.map(String).filter(Boolean) : [];
  const total = Math.max(0, Math.floor(Number(videoCount) || 0));
  if (!total || !accounts.length) return [];
  const startAt = Number(scheduleAt) || Math.floor(Date.now() / 1000);
  const intervalSeconds = Math.max(0, Number(intervalMinutes) || 0) * 60;
  const accountCounts = new Map();
  const dates = new Map();
  for (let index = 0; index < total; index++) {
    const envId = accounts[index % accounts.length];
    const accountIndex = accountCounts.get(envId) || 0;
    accountCounts.set(envId, accountIndex + 1);
    const plannedAt = startAt + accountIndex * intervalSeconds;
    const date = scheduleDateKey(plannedAt);
    const dateEntry = dates.get(date) || { count: 0, times: new Map() };
    dateEntry.count += 1;
    dateEntry.times.set(plannedAt, (dateEntry.times.get(plannedAt) || 0) + 1);
    dates.set(date, dateEntry);
  }
  return Array.from(dates, ([date, entry]) => ({
    date,
    count: entry.count,
    times: Array.from(entry.times, ([scheduleAt, count]) => ({ scheduleAt, count })).sort((a, b) => a.scheduleAt - b.scheduleAt)
  })).sort((a, b) => a.date.localeCompare(b.date));
}

export function validateScheduleCapacity({ plan, tasks = [], dailyLimit = DEFAULT_DAILY_PLANNED_VIDEOS, excludeTaskId = "" }) {
  const reserved = new Map();
  const reserve = (date, count) => reserved.set(date, (reserved.get(date) || 0) + count);
  for (const task of tasks) {
    if (!task || task.id === excludeTaskId || Number(task.deleted) === 1) continue;
    if (task.status === "done") {
      for (const result of task.publishResults || []) {
        if (result?.status !== "submitted") continue;
        const scheduleAt = Number(result.scheduleAt) || 0;
        if (!scheduleAt) continue;
        reserve(scheduleDateKey(scheduleAt), 1);
      }
      continue;
    }
    // Queued/running tasks have not published yet, so their whole plan is
    // still ahead of them; counting it stops several pending tasks from
    // overselling the same day.
    if (!ACTIVE_TASK_STATUSES.has(task.status)) continue;
    for (const item of getTaskSchedulePlan(task)) reserve(item.date, Number(item.count) || 0);
  }
  for (const item of plan || []) {
    const existing = reserved.get(item.date) || 0;
    const incoming = Number(item.count) || 0;
    if (existing + incoming > dailyLimit) {
      throw new Error(`${item.date} 已发布或已排期 ${existing} 条，本任务再安排 ${incoming} 条，将超过每天 ${dailyLimit} 条上限。请减少视频数量或改到其他日期。`);
    }
  }
}
function getTaskSchedulePlan(task) {
  if (!task?.publish?.autoPublish) return [];
  if (Array.isArray(task.schedulePlan) && task.schedulePlan.length) return task.schedulePlan;
  let videoCount = Number(task.expectedVideoCount) || Number(task.generatedVideos?.length) || 0;
  if (!videoCount && (task.generation?.audioDir || task.generation?.audioDirs?.length || task.generation?.audioItems?.length)) {
    try {
      videoCount = Number(task.generation.totalVideos)
        || ((task.generation.audioItems?.length || mixAudioFileCount(task.generation)) * (Number(task.generation.variants) || 1));
    } catch { videoCount = 0; }
  }
  const accountIds = getPublishAccountIds(task.publish);
  return buildSchedulePlan({ videoCount: videoCount, envIds: accountIds, scheduleAt: task.publish.scheduleAt, intervalMinutes: task.publish.intervalMinutes });
}

export function taskStillNeedsOutputFiles(task) {
  if (!task || Number(task.deleted) === 1 || task.status === "deleted") return false;
  if (task.status !== "done") return true;
  if (task.publishFailed) return true;
  const results = Array.isArray(task.publishResults) ? task.publishResults : [];
  if (results.some((item) => String(item.status || "") === "failed")) return true;
  const safelyPublished = results.length > 0 && results.every((item) => item.status === "submitted" || item.status === "skipped");
  if (safelyPublished) return false;
  const hasVideos = (Array.isArray(task.generatedVideos) ? task.generatedVideos : []).some((video) => String(video?.fileName || "").trim());
  return hasVideos && normalizePublishProvider(task.publish?.provider) === PUBLISH_PROVIDER_OFFICIAL;
}

export function missingOfficialPublishFiles({ videos = [], outputDir, savedAssets = {} } = {}) {
  const missing = [];
  for (const video of Array.isArray(videos) ? videos : []) {
    const fileName = path.basename(String(video?.fileName || "").trim());
    if (!fileName) continue;
    const filePath = path.resolve(outputDir, fileName);
    if (savedAssets[filePath]?.assetKey) continue;
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) missing.push(fileName);
  }
  return [...new Set(missing)];
}

export function describeMissingOfficialPublishFiles(names) {
  const list = [...new Set((Array.isArray(names) ? names : []).map((name) => String(name || "").trim()).filter(Boolean))];
  if (!list.length) return "";
  const shown = list.slice(0, 8);
  const extra = list.length > shown.length ? ` 等 ${list.length} 条` : "";
  return `找不到待发布视频：${shown.join("、")}${extra}`;
}

export function resolveOfficialAccountAssignment(value) {
  return String(value || "").trim().toLowerCase() === "all-accounts" ? "all-accounts" : "round-robin";
}

export function planOfficialPublishJobs({
  videos = [],
  connectionIds = [],
  scheduleAt = 0,
  interval = 0,
  assignment = "round-robin"
} = {}) {
  assignment = resolveOfficialAccountAssignment(assignment);
  const accounts = Array.from(new Set((Array.isArray(connectionIds) ? connectionIds : []).map((value) => String(value || "").trim()).filter(Boolean)));
  const list = Array.isArray(videos) ? videos : [];
  if (!list.length || !accounts.length) return [];
  const startAt = Number(scheduleAt) || 0;
  const step = Math.max(0, Number(interval) || 0);
  const jobs = [];
  if (assignment === "all-accounts") {
    list.forEach((video, videoIndex) => {
      accounts.forEach((connectionId) => {
        jobs.push({ video, videoIndex, connectionId, scheduleAt: startAt + videoIndex * step });
      });
    });
    return jobs;
  }
  // Round-robin, but audio-aware: with A audios and n accounts the plain
  // `videoIndex % n` mapping lands the same story on the same account every
  // time A is a multiple of n. Among the least-loaded accounts we prefer one
  // that has not posted this audio yet, so an account only repeats a story
  // when every account already has it. Deterministic, so re-running this on
  // the same task reproduces the same plan (publish records rely on that).
  const postCounts = new Map(accounts.map((id) => [id, 0]));
  const seenAudio = new Map(accounts.map((id) => [id, new Set()]));
  list.forEach((video, videoIndex) => {
    const audioKey = String(video?.audioName || video?.audioLibraryId || "").trim().toLowerCase();
    const minCount = Math.min(...accounts.map((id) => postCounts.get(id)));
    const preferred = accounts[videoIndex % accounts.length];
    const startIndex = accounts.indexOf(preferred);
    let connectionId = "";
    let fallback = "";
    for (let offset = 0; offset < accounts.length; offset += 1) {
      const candidate = accounts[(startIndex + offset) % accounts.length];
      if (postCounts.get(candidate) !== minCount) continue;
      if (!fallback) fallback = candidate;
      if (!audioKey || !seenAudio.get(candidate).has(audioKey)) {
        connectionId = candidate;
        break;
      }
    }
    connectionId = connectionId || fallback || preferred;
    const accountPostIndex = postCounts.get(connectionId);
    postCounts.set(connectionId, accountPostIndex + 1);
    if (audioKey) seenAudio.get(connectionId).add(audioKey);
    jobs.push({
      video,
      videoIndex,
      connectionId,
      scheduleAt: startAt + accountPostIndex * step + accountStagger(step, accounts.indexOf(connectionId), accounts.length)
    });
  });
  return jobs;
}

// Spread the accounts' posts across the interval instead of firing all of
// them at the same second: account k posts at wave start + k/n of the gap.
export function accountStagger(step, accountIndex, accountCount) {
  const gap = Math.max(0, Number(step) || 0);
  const count = Math.max(1, Math.floor(Number(accountCount) || 1));
  const index = Math.max(0, Math.floor(Number(accountIndex) || 0));
  if (!gap || count <= 1) return 0;
  return Math.floor((gap * index) / count);
}

export function normalizeOfficialAutoPublishResult(task, officialResult = {}) {
  const connectionIds = Array.isArray(task?.publish?.connectionIds) ? task.publish.connectionIds.map(String).filter(Boolean) : [];
  const videos = Array.isArray(task?.generatedVideos) ? task.generatedVideos : [];
  const baseScheduleAt = Number(task?.publish?.scheduleAt) || Math.floor(Date.now() / 1000);
  const intervalSeconds = Math.max(0, Number(task?.publish?.intervalMinutes) || 0) * 60;
  const batches = Array.isArray(officialResult?.batches) ? officialResult.batches : [];
  const batchIds = batches.map((batch) => batch?.id || batch?.batchId).filter(Boolean);
  const remoteTasks = batches.flatMap((batch) => (Array.isArray(batch?.tasks) ? batch.tasks : []).map((remoteTask) => ({
    ...remoteTask,
    batchId: remoteTask?.batchId || batch?.id || batch?.batchId || ""
  })));
  const planned = planOfficialPublishJobs({
    videos,
    connectionIds,
    scheduleAt: baseScheduleAt,
    interval: intervalSeconds,
    assignment: task?.publish?.accountAssignment
  });
  const results = planned.map((job, jobIndex) => {
    const expectedExternalRef = `${String(job.video?.fileName || "")}:${job.connectionId}:${jobIndex}`.slice(0, 160);
    const remoteTask = remoteTasks.find((item) => item?.externalRef === expectedExternalRef)
      || remoteTasks.find((item) => item?.connectionId === job.connectionId && item?.fileName === String(job.video?.fileName || ""));
    const batchId = remoteTask?.batchId || batchIds[Math.floor(jobIndex / 100)] || batchIds[0] || "";
    return {
      recordId: `${task.id}:official:${job.videoIndex}:${job.connectionId}`,
      dedupeKey: `${task.id}:official:${job.videoIndex}:${job.connectionId}`,
      provider: PUBLISH_PROVIDER_OFFICIAL,
      videoIndex: job.videoIndex,
      connectionId: job.connectionId,
      fileName: String(job.video?.fileName || ""),
      scheduleAt: job.scheduleAt,
      externalRef: remoteTask?.externalRef || expectedExternalRef,
      remoteTaskId: remoteTask?.id || "",
      status: "submitted",
      message: "已提交发布中台",
      batchIds: batchId ? [batchId] : []
    };
  });
  return {
    results,
    summary: { total: results.length, submitted: results.length, pending: 0, failed: 0, needsCheck: 0, skipped: 0 },
    raw: officialResult
  };
}

export function collectOfficialBatchIds(results = [], extraBatchIds = []) {
  return Array.from(new Set([
    ...(Array.isArray(extraBatchIds) ? extraBatchIds : []),
    ...(Array.isArray(results) ? results.flatMap((item) => Array.isArray(item?.batchIds) ? item.batchIds : [item?.batchId]) : [])
  ].map(String).filter(Boolean)));
}

function markOfficialResultsHandedOff(results = []) {
  return (Array.isArray(results) ? results : []).map((result) => ({
    ...result,
    status: result?.status === "failed" ? "failed" : "submitted",
    message: result?.status === "failed" ? result?.message : "已提交发布中台",
  }));
}

export function mergeOfficialRemoteResults(localResults = [], batches = []) {
  const remoteTasks = (Array.isArray(batches) ? batches : []).flatMap((batch) =>
    (Array.isArray(batch?.tasks) ? batch.tasks : []).map((task) => ({
      ...task,
      batchId: task?.batchId || batch?.id || batch?.batchId || ""
    }))
  );
  const byExternalRef = new Map(remoteTasks.map((task) => [String(task?.externalRef || ""), task]).filter(([key]) => key));
  const unmatched = remoteTasks.slice();
  return (Array.isArray(localResults) ? localResults : []).map((result) => {
    let remote = byExternalRef.get(String(result?.externalRef || ""));
    if (!remote) {
      const index = unmatched.findIndex((task) =>
        String(task?.connectionId || "") === String(result?.connectionId || "")
        && String(task?.fileName || "") === String(result?.fileName || "")
      );
      if (index >= 0) remote = unmatched.splice(index, 1)[0];
    }
    if (!remote) return { ...result, status: "pending", message: result?.message || "等待 TikTok 最终结果" };
    const remoteStatus = String(remote.status || "").toLowerCase();
    const published = remoteStatus === "published";
    const failed = ["failed", "rejected", "status_timeout", "needs_review", "enqueue_failed", "canceled"].includes(remoteStatus);
    return {
      ...result,
      externalRef: remote.externalRef || result.externalRef,
      remoteTaskId: remote.id || result.remoteTaskId || "",
      batchIds: [remote.batchId || result.batchIds?.[0]].filter(Boolean),
      status: published ? "submitted" : failed ? "failed" : "pending",
      message: published
        ? "TikTok 已确认发布成功"
        : failed
          ? String(remote.error || `TikTok 发布失败（${remoteStatus || "unknown"}）`)
          : `TikTok 正在处理（${remoteStatus || "queued"}）`,
      publishId: remote.publishId || "",
      videoId: remote.videoId || "",
      videoUrl: remote.videoUrl || "",
      remoteStatus,
      remoteUpdatedAt: Number(remote.updatedAt) || Date.now()
    };
  });
}

export function summarizeOfficialResults(results = []) {
  const list = Array.isArray(results) ? results : [];
  return {
    total: list.length,
    submitted: list.filter((item) => item.status === "submitted").length,
    pending: list.filter((item) => item.status === "pending").length,
    failed: list.filter((item) => item.status === "failed").length,
    needsCheck: list.filter((item) => item.status === "needs_check").length,
    skipped: list.filter((item) => item.status === "skipped").length
  };
}

export function buildOfficialPublishRecords(task, results, now = Date.now(), recordsWorkDir = "") {
  const videos = Array.isArray(task?.generatedVideos) ? task.generatedVideos : [];
  const accounts = new Map((Array.isArray(task?.publish?.officialAccounts) ? task.publish.officialAccounts : [])
    .map((account) => [String(account?.connectionId || account?.id || ""), account]));
  return (Array.isArray(results) ? results : []).map((result) => {
    const video = videos[Number(result?.videoIndex) || 0] || {};
    const connectionId = String(result?.connectionId || "");
    const account = accounts.get(connectionId) || {};
    const batchIds = Array.isArray(result?.batchIds) ? result.batchIds.map(String).filter(Boolean) : [];
    const id = String(result?.recordId || result?.dedupeKey || `${task?.id || "task"}:official:${connectionId}`);
    return {
      id,
      dedupeKey: String(result?.dedupeKey || id),
      batchId: batchIds[0] || "",
      createdAt: now,
      updatedAt: now,
      source: "official-tiktok",
      provider: PUBLISH_PROVIDER_OFFICIAL,
      geelarkProfileId: String(task?.geelarkProfileId || task?.publish?.geelarkProfileId || "default"),
      ownerUserId: String(task?.ownerUserId || task?.publish?.ownerUserId || ""),
      platform: "tiktok",
      status: String(result?.status || "submitted"),
      attempts: 1,
      fileName: String(result?.fileName || video?.fileName || ""),
      title: String(video?.title || task?.name || ""),
      audioName: String(video?.audioName || ""),
      audioLibraryId: String(video?.audioLibraryId || video?.audioId || video?.sourceAudioId || ""),
      sourceAudioId: String(video?.sourceAudioId || video?.audioId || video?.audioLibraryId || ""),
      scriptId: String(video?.scriptId || ""),
      novelId: String(video?.novelId || task?.generation?.novelId || ""),
      username: String(account?.username || account?.name || ""),
      publishedAt: (Number(result?.scheduleAt) || Number(task?.publish?.scheduleAt) || Math.floor(now / 1000)) * 1000,
      videoId: String(result?.videoId || result?.tiktokVideoId || ""),
      audioIndex: Number(video?.audioIndex) || 0,
      template: String(video?.template || "reddit-mix"),
      templateIndex: Number(video?.templateIndex) || 0,
      templateLabel: String(video?.templateLabel || "Reddit 混剪"),
      variant: Number(video?.variant) || 1,
      localVideoUrl: String(video?.videoUrl || video?.url || `/outputs/${encodeURIComponent(result?.fileName || video?.fileName || "")}`),
      resourceUrl: "",
      taskIds: batchIds,
      autoTaskId: String(task?.id || ""),
      assignedEnvId: connectionId,
      connectionId,
      accountName: String(account?.name || account?.displayName || account?.username || connectionId),
      accountUsername: String(account?.username || ""),
      accountSerialNo: "",
      groupName: "TikTok 官方 API",
      videoDesc: resolveTikTokCaption({
        workDir: recordsWorkDir,
        video,
        seed: `${connectionId}:${String(result?.fileName || video?.fileName || "")}`,
        captionMode: task?.publish?.captionMode,
        manualCaption: task?.publish?.videoDesc,
        fallback: {
          novelId: video?.novelId || task?.generation?.novelId,
          platform: video?.novelPlatform || task?.generation?.novelPlatform,
          promotionCopy: video?.promotionCopy
        }
      }),
      operationMeta: task?.publish?.operationMeta || video?.operationMeta || null,
      scheduleAt: Number(result?.scheduleAt) || Number(task?.publish?.scheduleAt) || Math.floor(now / 1000),
      intervalMinutes: Number(task?.publish?.intervalMinutes) || 0,
      shareLink: "",
      metrics: null,
      lastCheckedAt: null,
      officialBatchIds: batchIds,
      externalRef: String(result?.externalRef || ""),
      remoteTaskId: String(result?.remoteTaskId || ""),
      note: String(result?.message || "已提交到 TikTok 官方 API")
    };
  });
}

export function persistOfficialPublishRecords(workDir, task, results) {
  const recordsPath = path.join(workDir, "publish-records.json");
  const current = readJson(recordsPath, []);
  const incoming = buildOfficialPublishRecords(task, results, Date.now(), workDir);
  const incomingIds = new Set(incoming.map((record) => record.id));
  const previousById = new Map(current.map((record) => [String(record?.id || ""), record]));
  const mergedIncoming = incoming.map((record) => ({
    ...previousById.get(record.id),
    ...record,
    createdAt: Number(previousById.get(record.id)?.createdAt) || record.createdAt
  }));
  writeJson(recordsPath, [...mergedIncoming, ...current.filter((record) => !incomingIds.has(String(record?.id || "")))]);
  return mergedIncoming;
}

function normalizeAudioItems(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      id: String(item?.id || "").trim(),
      path: String(item?.path || item?.file || "").trim(),
      fileName: String(item?.fileName || "").trim(),
      novelId: String(item?.novelId || "").trim(),
      platform: String(item?.platform || item?.novelPlatform || "").trim(),
      promotionCode: String(item?.promotionCode || item?.novelPromotionCode || "").trim(),
      promotionCopy: String(item?.promotionCopy || "").trim(),
      openingTitle: String(item?.openingTitle || item?.title || "").trim(),
      title: String(item?.title || "").trim(),
      bookId: String(item?.bookId || item?.novelBookId || "").trim(),
      novelTitle: String(item?.novelTitle || "").trim()
    }))
    .filter((item) => item.id || item.path)
    .slice(0, 300);
}

function mixAudioFileCount(generation = {}) {
  const items = normalizeAudioItems(generation.audioItems);
  if (items.length) return items.length;
  return normalizeAudioDirs(generation.audioDirs, generation.audioDir).reduce((sum, dir) => sum + countAudioFiles(dir), 0);
}

function countAudioFiles(directory) {
  const root = path.resolve(String(directory || "").trim());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return 0;
  let count = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) count += 1;
    }
  }
  return count;
}

function mergePublishResults(current, incoming) {
  const map = new Map(current.map((item) => [item.dedupeKey || item.recordId, item]));
  for (const item of incoming) map.set(item.dedupeKey || item.recordId, item);
  return Array.from(map.values());
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
  fs.renameSync(temp, filePath);
}

function safeId(value) {
  return String(value || "task").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160) || "task";
}

function killProcessTree(pid) {
  const safePid = Number(pid);
  if (!Number.isInteger(safePid) || safePid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(safePid), "/T", "/F"], { encoding: "utf8", windowsHide: true });
    return;
  }
  try { process.kill(safePid, "SIGTERM"); } catch { /* already stopped */ }
}
