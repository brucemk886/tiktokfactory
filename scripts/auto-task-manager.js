import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".opus", ".webm"]);
const MAX_DAILY_PLANNED_VIDEOS = 300;

export function createAutoTaskManager({ root, workDir, outputDir, publishService, outputRetentionHours = 48 }) {
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
    const publish = normalizePublishPayload(payload.publish);
    publish.geelarkProfileId = String(payload.geelarkProfileId || publish.geelarkProfileId || "default");
    publish.ownerUserId = String(payload.ownerUserId || publish.ownerUserId || "");
    const expectedVideoCount = taskType === "psychology" || taskType === "schulte"
      ? generation.totalVideos
      : generation.totalVideos || countAudioFiles(generation.audioDir) * generation.variants;
    if (!expectedVideoCount) {
      throw new Error(
        taskType === "psychology"
          ? "请设置心理学视频生成数量。"
          : taskType === "schulte"
            ? "请设置舒尔特视频生成数量。"
            : "音频目录中没有找到可用音频文件。"
      );
    }
    const schedulePlan = publish.autoPublish
      ? buildSchedulePlan({ videoCount: expectedVideoCount, envIds: publish.envIds, scheduleAt: publish.scheduleAt, intervalMinutes: publish.intervalMinutes })
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
    if (task.workerPid) killProcessTree(task.workerPid);
    patchTask(task.id, {
      status: "canceled",
      phase: "canceled",
      message: "任务已停止。已提交到 GeeLark 的任务不会被撤销。",
      workerPid: null,
      updatedAt: Date.now()
    });
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
        const next = listTasks().filter((task) => task.status === "queued").sort((a, b) => {
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
      if (!task.publish.autoPublish) {
        patchTask(id, { status: "awaiting_review", phase: "awaiting_review", message: "视频已生成，等待人工确认发布。", updatedAt: Date.now() });
        return;
      }

      patchTask(id, { phase: "publishing", message: "正在安全提交到 GeeLark...", updatedAt: Date.now() });
      const result = await publishService.publishBatch({
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
      if (getTask(id).status === "canceled") return;
      const hasManual = result.results.some((item) => item.status === "failed" || item.status === "needs_check");
      patchTask(id, {
        status: hasManual ? "needs_attention" : "done",
        phase: hasManual ? "needs_attention" : "done",
        publishResults: result.results,
        publishSummary: result.summary,
        message: hasManual ? "主任务已完成，部分发布需要人工处理。" : "生成和发布任务全部完成。",
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
      fs.writeFileSync(payloadPath, JSON.stringify({ ...task.generation, jobId }, null, 2), "utf8");
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
    writeTask({ ...task, ...patch });
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
        .filter((task) => task.status !== "done")
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

  return { createTask, listTasks, getTask, cancelTask, archiveTask, renameTask, resumeTask, retryPublishRecord, runOutputCleanup, getStatus: () => ({ workerRunning, activeTaskId, retentionHours, cleanup: cleanupStatus }) };
}

function validateTaskPayload(payload) {
  const generation = payload?.generation || {};
  const publish = payload?.publish || {};
  if (payload?.taskType === "psychology") {
    if (!String(generation.question || "").trim()) throw new Error("请输入心理学测试题目。");
    if (!String(generation.elevenLabsVoiceId || "").trim()) throw new Error("请配置 ElevenLabs Voice ID。");
    if (publish.autoPublish !== false && !(Array.isArray(publish.envIds) && publish.envIds.length)) throw new Error("请选择至少一个 GeeLark 账号。");
    const scheduleAt = Number(publish.scheduleAt);
    if (publish.autoPublish !== false && (!Number.isFinite(scheduleAt) || scheduleAt < Math.floor(Date.now() / 1000) + 300)) throw new Error("自动发布的起始时间至少需要晚于当前时间 5 分钟。");
    return;
  }
  if (payload?.taskType === "schulte") {
    if (!["wheel", "tracking", "memory", "peripheral"].includes(generation.template)) throw new Error("请选择舒尔特训练模板。");
    if (!(Number(generation.totalVideos) >= 1)) throw new Error("舒尔特视频生成数量至少为 1 条。");
    if (publish.autoPublish !== false && !(Array.isArray(publish.envIds) && publish.envIds.length)) throw new Error("请选择至少一个 GeeLark 账号。");
    const scheduleAt = Number(publish.scheduleAt);
    if (publish.autoPublish !== false && (!Number.isFinite(scheduleAt) || scheduleAt < Math.floor(Date.now() / 1000) + 300)) throw new Error("自动发布的起始时间至少需要晚于当前时间 5 分钟。");
    return;
  }
  if (!String(generation.assetGroupId || "").trim() && !String(generation.videoDir || "").trim()) throw new Error("请选择素材组或视频素材目录。");
  if (!String(generation.audioDir || "").trim()) throw new Error("请选择音频目录。");
  if (publish.autoPublish !== false && !(Array.isArray(publish.envIds) && publish.envIds.length)) throw new Error("请选择至少一个 GeeLark 账号。");
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
  return {
    videoDir: String(value.videoDir || ""),
    includeVideoSubfolders: value.includeVideoSubfolders !== false,
    audioDir: String(value.audioDir || ""),
    backgroundMusicDir: String(value.backgroundMusicDir || ""),
    backgroundMusicVolume: Number(value.backgroundMusicVolume) || 0.12,
    saveDir: String(value.saveDir || ""),
    assetGroupId: String(value.assetGroupId || ""),
    segmentMode: value.segmentMode === "ratio" ? "ratio" : "fixed",
    segmentSeconds: Number(value.segmentSeconds) || 5,
    segmentRatio: Number(value.segmentRatio) || 10,
    variants: Math.max(1, Math.min(20, Number(value.variants) || 1)),
    totalVideos: Math.max(0, Math.min(300, Math.floor(Number(value.totalVideos) || 0))),
    subtitleYPercent: Number(value.subtitleYPercent) || 66,
    subtitleFontSize: Number(value.subtitleFontSize) || 62,
    subtitleAnimationMode: value.subtitleAnimationMode === "word-highlight" ? "word-highlight" : "sentence",
    quality: value.quality === "quality" ? "quality" : "fast",
    autoCaptions: value.autoCaptions !== false,
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

function normalizePublishPayload(value = {}) {
  return {
    autoPublish: value.autoPublish !== false,
    envIds: Array.isArray(value.envIds) ? value.envIds.map(String).filter(Boolean) : [],
    accounts: Array.isArray(value.accounts) ? value.accounts : [],
    videoDesc: String(value.videoDesc || ""),
    scheduleAt: Number(value.scheduleAt) || Math.floor(Date.now() / 1000),
    intervalMinutes: Math.max(0, Number(value.intervalMinutes) || 0),
    dailyPublishLimit: MAX_DAILY_PLANNED_VIDEOS,
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

export function validateScheduleCapacity({ plan, tasks = [], dailyLimit = MAX_DAILY_PLANNED_VIDEOS, excludeTaskId = "" }) {
  const completed = new Map();
  for (const task of tasks) {
    if (!task || task.id === excludeTaskId || task.status !== "done") continue;
    for (const result of task.publishResults || []) {
      if (result?.status !== "submitted") continue;
      const scheduleAt = Number(result.scheduleAt) || 0;
      if (!scheduleAt) continue;
      const date = scheduleDateKey(scheduleAt);
      completed.set(date, (completed.get(date) || 0) + 1);
    }
  }
  for (const item of plan || []) {
    const existing = completed.get(item.date) || 0;
    const incoming = Number(item.count) || 0;
    if (existing + incoming > dailyLimit) {
      throw new Error(`${item.date} 已完成发布 ${existing} 条，本任务再安排 ${incoming} 条，将超过每天 ${dailyLimit} 条上限。请减少视频数量或改到其他日期。`);
    }
  }
}
function getTaskSchedulePlan(task) {
  if (!task?.publish?.autoPublish) return [];
  if (Array.isArray(task.schedulePlan) && task.schedulePlan.length) return task.schedulePlan;
  let videoCount = Number(task.expectedVideoCount) || Number(task.generatedVideos?.length) || 0;
  if (!videoCount && task.generation?.audioDir) {
    try { videoCount = Number(task.generation.totalVideos) || countAudioFiles(task.generation.audioDir) * (Number(task.generation.variants) || 1); } catch { videoCount = 0; }
  }
  return buildSchedulePlan({ videoCount, envIds: task.publish.envIds, scheduleAt: task.publish.scheduleAt, intervalMinutes: task.publish.intervalMinutes });
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

function scheduleDateKey(value) {
  const date = new Date(Number(value) * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
