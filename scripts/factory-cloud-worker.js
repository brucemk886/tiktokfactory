import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildAssetUsageSnapshot, discoverAssetLibraryGroups, listAssetGroups, listMediaFiles, VIDEO_EXTENSIONS } from "./asset-library.js";
import { runAudioImportJob } from "./audio-import-job.js";
import { runAudioGenerateJob } from "./audio-generate-job.js";
import { createAudioLibraryService } from "./audio-library.js";
import { discoverAudioLibraryGroups, latestAudioCatalog, resolveAudioLibraryRoot, resolveTargetAudioDir } from "./audio-library-groups.js";
import { resolveLocalAudioUploadPath } from "./novel-audio-upload.js";
import { createCodexBrainService } from "./codex-brain.js";
import { buildOfficialPublishRecords, normalizeOfficialAutoPublishResult, persistOfficialPublishRecords } from "./auto-task-manager.js";
import { filterPublishRecordsBySource } from "./publish-record-sources.js";
import { normalizeOfficialPublishRecord } from "./official-publish-records.js";
import { isOfficialPublishAbort } from "./official-publish-abort.js";
import { normalizePublishProvider, PUBLISH_PROVIDER_OFFICIAL } from "./publish-provider.js";
import { readConfig } from "./video-core.js";
import { resolveStorageDirs } from "./storage-paths.js";

const SCRIPT_BY_TYPE = {
  generate: "render-job.js",
  "reddit-mix": "reddit-mix-job.js",
  "auto-task": "reddit-mix-job.js",
  schulte: "schulte-render-job.js",
  "schulte-batch": "schulte-batch-job.js",
  "psychology-collage": "psychology-collage-job.js",
  "psychology-target-2": "psychology-narrative-job.js",
  quiz: "quiz-render-job.js",
  "asset-preprocess": "asset-preprocess-job.js",
  "folder-classify": "folder-classify-job.js",
  unsplash: "unsplash-image-job.js",
  "asset-reindex": "asset-index-job.js",
  psychology: "psychology-video-job.js"
};

export function startFactoryCloudWorker({ root = process.cwd(), workDir, mirrorTask, publishOfficial } = {}) {
  const config = readConfig(root);
  const storage = resolveStorageDirs(root, config);
  const resolvedWorkDir = workDir || storage.workDir;
  const jobsDir = path.join(resolvedWorkDir, "jobs");
  const settings = loadSettings(resolvedWorkDir);
  if (!settings.url || !settings.token) {
    console.log("未配置工厂云工人，跳过拉单。需要 work/factory-cloud-worker.json 或 FACTORY_CLOUD_URL / FACTORY_WORKER_TOKEN。");
    return { running: false };
  }

  fs.mkdirSync(jobsDir, { recursive: true });
  const workerId = settings.workerId || `local-${process.platform}-${process.pid}`;
  const context = { root, workDir: resolvedWorkDir, jobsDir, settings, workerId, config, mirrorTask, publishOfficial, cloudSplitPublish: false };
  const lanes = workerLanes(settings);
  console.log(`工厂云工人已接入：${settings.url}  worker=${workerId}  渲染并发=${lanes[0].concurrency} 发布并发=${lanes[1].concurrency}`);
  helloWorker(context).catch((error) => console.error("工人报到失败：", error.message || error));
  syncInventory(context).catch((error) => console.error("同步发布记录失败：", error.message || error));
  syncDailyViewData(context);
  setInterval(() => {
    syncInventory(context).catch((error) => console.error("同步发布记录失败：", error.message || error));
    syncDailyViewData(context);
  }, settings.syncMs || DEFAULT_SYNC_MS);
  for (const lane of lanes) {
    laneLoop(context, lane).catch((error) => {
      console.error(`工厂云工人 ${lane.name} 通道退出：`, error);
    });
  }
  return { running: true, workerId, lanes: lanes.map((lane) => ({ name: lane.name, concurrency: lane.concurrency })) };
}

export function helloPayload(context) {
  const lanes = workerLanes(context.settings || {});
  return {
    workerId: context.workerId,
    label: String(context.settings?.label || ""),
    hostname: os.hostname(),
    assignedOnly: context.settings?.assignedOnly === true,
    renderConcurrency: lanes[0].concurrency,
    publishConcurrency: lanes[1].concurrency,
    renderJobTypes: normalizeJobTypes(context.settings?.renderJobTypes)
  };
}

async function helloWorker(context) {
  const data = await request(context, "/api/worker/hello", { method: "POST", body: helloPayload(context) });
  context.cloudSplitPublish = Boolean(data?.splitPublish);
  if (Number(data?.requeued || 0) > 0) {
    console.log(`工人重启，已把 ${data.requeued} 条中断任务重新排队。`);
  }
}

export const PUBLISH_JOB_TYPES = ["official-publish"];
export const DEFAULT_RENDER_CONCURRENCY = 2;
export const DEFAULT_PUBLISH_CONCURRENCY = 1;

// Render jobs (ffmpeg, TTS) and publish jobs (uploads to the desk) have very
// different bottlenecks, so each lane claims and runs its own job types with
// its own concurrency instead of one serial loop doing everything.
export function workerLanes(settings = {}) {
  // A secondary worker that only mirrors the video/audio libraries should not
  // pick up jobs that create machine-local state (audio generation, asset
  // indexing, folder classification), otherwise the primary never sees the
  // result. renderJobTypes narrows its render lane to a whitelist.
  const renderTypes = normalizeJobTypes(settings.renderJobTypes).filter((type) => !PUBLISH_JOB_TYPES.includes(type));
  return [
    {
      name: "render",
      concurrency: clampConcurrency(settings.renderConcurrency, DEFAULT_RENDER_CONCURRENCY),
      claim: renderTypes.length ? { types: renderTypes } : { excludeTypes: PUBLISH_JOB_TYPES }
    },
    {
      name: "publish",
      concurrency: clampConcurrency(settings.publishConcurrency, DEFAULT_PUBLISH_CONCURRENCY),
      claim: { types: PUBLISH_JOB_TYPES }
    }
  ];
}

function clampConcurrency(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(8, number) : fallback;
}

export function normalizeJobTypes(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 20);
}

async function laneLoop(context, lane) {
  const active = new Set();
  const pollMs = context.settings.pollMs || DEFAULT_POLL_MS;
  while (true) {
    if (active.size >= lane.concurrency) {
      await Promise.race(active);
      continue;
    }
    let claimed = null;
    try {
      claimed = await request(context, "/api/worker/claim", {
        method: "POST",
        body: { workerId: context.workerId, lane: lane.name, assignedOnly: context.settings.assignedOnly === true, ...lane.claim }
      });
    } catch (error) {
      console.error(`拉单失败（${lane.name}）：`, error.message || error);
      await sleep(5000);
      continue;
    }
    if (claimed?.job) {
      const running = runJob(context, claimed.job)
        .catch((error) => console.error(`任务执行失败（${lane.name}）：`, error.message || error))
        .finally(() => active.delete(running));
      active.add(running);
      continue;
    }
    // Nothing queued: wait for a poll interval, or wake early when a slot frees.
    await (active.size ? Promise.race([...active, sleep(pollMs)]) : sleep(pollMs));
  }
}

async function runJob(context, job) {
  const jobId = job.id || job.jobId;
  const type = resolveJobType(job);
  console.log(`接到工厂云任务 ${jobId} (${type})`);
  if (type === "official-publish") {
    await runOfficialPublishJob(context, job);
    return;
  }
  if (type === "audio-generate") {
    await runAudioGenerateCloudJob(context, job);
    return;
  }
  if (type === "audio-import") {
    await runAudioImportCloudJob(context, job);
    return;
  }
  if (type === "audio-ensure-folder") {
    await runAudioEnsureFolderJob(context, job);
    return;
  }
  if (type === "opening-variants") {
    await runOpeningVariantsJob(context, job);
    return;
  }
  if (type === "opening-titles") {
    await runOpeningTitlesJob(context, job);
    return;
  }
  const payloadPath = path.join(context.jobsDir, `${jobId}.payload.json`);
  const jobPath = path.join(context.jobsDir, `${jobId}.json`);
  const payload = buildLocalPayload(job);
  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), "utf8");
  writeLocalJob(jobPath, { jobId, status: "running", percent: 2, message: "Local Factory 已开始混剪", createdAt: Date.now() });
  mirrorCloudTask(context, job, { status: "running", percent: 2, message: "Local Factory 已开始混剪" });

  const scriptName = SCRIPT_BY_TYPE[type];
  if (!scriptName) {
    await complete(context, jobId, { error: `工人机暂不执行 ${type}。`, percent: 0 });
    return;
  }

  const child = spawn(process.execPath, [path.join(context.root, "scripts", scriptName), payloadPath, jobPath], {
    cwd: context.root,
    stdio: "ignore",
    windowsHide: true
  });

  let lastFingerprint = "";
  while (true) {
    const local = readLocalJob(jobPath);
    const fingerprint = `${local.status}|${local.percent}|${local.message}`;
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      mirrorCloudTask(context, job, local);
    }
    if (isCancelStatus(local.status) || localJobCancelled(context, job, jobId)) {
      await abortRunningJob(context, job, jobId, jobPath, child);
      break;
    }
    if (["done", "completed", "success", "failed", "error"].includes(String(local.status || ""))) {
      const failed = ["failed", "error"].includes(String(local.status || ""));
      mirrorCloudTask(context, job, local);
      await finishCloudJob(context, job, jobId, local, failed);
      break;
    }
    if (child.exitCode !== null) {
      await sleep(1500);
      const latest = readLocalJob(jobPath);
      if (isCancelStatus(latest.status) || localJobCancelled(context, job, jobId)) {
        await abortRunningJob(context, job, jobId, jobPath, child);
        break;
      }
      const failed = !["done", "completed", "success"].includes(String(latest.status || ""));
      mirrorCloudTask(context, job, latest);
      await finishCloudJob(context, job, jobId, latest, failed);
      break;
    }
    await sleep(LOCAL_WATCH_MS);
  }
}

async function runOpeningVariantsJob(context, job) {
  const jobId = job.id || job.jobId;
  const payload = job.payload || {};
  try {
    const brain = createCodexBrainService({ root: context.root, workDir: context.workDir });
    const result = await brain.generateOpeningVariants(payload);
    await complete(context, jobId, {
      error: "",
      message: `已生成 ${Array.isArray(result.variants) ? result.variants.length : 0} 个改版开头`,
      result,
      percent: 100
    });
  } catch (error) {
    await complete(context, jobId, {
      error: error.message || "生成改版开头失败。",
      percent: 0
    });
  }
}

async function runOpeningTitlesJob(context, job) {
  const jobId = job.id || job.jobId;
  const payload = job.payload || {};
  try {
    const brain = createCodexBrainService({ root: context.root, workDir: context.workDir });
    const result = await brain.generateOpeningTitles(payload);
    await complete(context, jobId, {
      error: "",
      message: `已重写 ${Array.isArray(result.titles) ? result.titles.length : 0} 个开头标题`,
      result,
      percent: 100
    });
  } catch (error) {
    await complete(context, jobId, {
      error: error.message || "重写开头标题失败。",
      percent: 0
    });
  }
}

async function runAudioImportCloudJob(context, job) {
  const jobId = job.id || job.jobId;
  const payload = job.payload || {};
  try {
    const result = await runAudioImportJob({
      root: context.root,
      workDir: context.workDir,
      config: context.config,
      payload,
      cloudUrl: context.settings.url,
      workerToken: context.settings.token,
      workerId: context.workerId
    });
    const failedText = result.failed?.length ? `，${result.failed.length} 条本机未写入` : "";
    await complete(context, jobId, {
      error: "",
      message: `已把 ${result.items.length} 条上传音频写到 ${result.targetAudioDir}${failedText}`,
      result,
      percent: 100
    });
  } catch (error) {
    await complete(context, jobId, {
      error: error.message || "上传音频写入本机失败。",
      percent: 0
    });
  }
}

async function runAudioEnsureFolderJob(context, job) {
  const jobId = job.id || job.jobId;
  const payload = job.payload || {};
  try {
    const targetAudioDir = resolveTargetAudioDir(context.config, "__novel__", {
      novelTitle: payload.novelTitle,
      platform: payload.platform
    });
    await complete(context, jobId, {
      error: "",
      message: `已在本机创建 ${targetAudioDir}`,
      result: { targetAudioDir, novelTitle: payload.novelTitle || "" },
      percent: 100
    });
  } catch (error) {
    await complete(context, jobId, {
      error: error.message || "本机创建音频文件夹失败。",
      percent: 0
    });
  }
}

async function runAudioGenerateCloudJob(context, job) {
  const jobId = job.id || job.jobId;
  const payload = job.payload || {};
  const library = createAudioLibraryService({
    root: context.root,
    workDir: context.workDir,
    readConfig: () => context.config
  });
  try {
    const result = await runAudioGenerateJob({
      root: context.root,
      workDir: context.workDir,
      config: context.config,
      payload,
      audioLibrary: library
    });
    const upload = await uploadNovelAudiosToCloud(context, result.items, library);
    const failedText = result.failed?.length ? `，${result.failed.length} 条失败` : "";
    const uploadText = upload.uploaded ? `，已传到网页 ${upload.uploaded} 条可试听` : "";
    const uploadFail = upload.failed.length ? `，${upload.failed.length} 条网页试听未传上` : "";
    await complete(context, jobId, {
      error: "",
      message: `已保存 ${result.items.length} 条到 ${result.targetAudioDir}${failedText}${uploadText}${uploadFail}`,
      result: { ...result, uploadedCount: upload.uploaded, uploadFailed: upload.failed },
      percent: 100
    });
  } catch (error) {
    await complete(context, jobId, {
      error: error.message || "小说音频生成失败。",
      percent: 0
    });
  }
}

async function uploadNovelAudiosToCloud(context, items, library) {
  let uploaded = 0;
  const failed = [];
  for (const item of items || []) {
    const audioId = String(item.audioId || "").trim();
    if (!audioId) continue;
    const filePath = resolveLocalAudioUploadPath(library, item);
    if (!filePath) {
      failed.push(audioId);
      continue;
    }
    try {
      await uploadAudioFile(context, audioId, filePath);
      uploaded += 1;
    } catch (error) {
      console.error(`上传试听失败 ${audioId}：`, error.message || error);
      failed.push(audioId);
    }
  }
  return { uploaded, failed };
}

async function uploadAudioFile(context, audioId, filePath) {
  const body = fs.readFileSync(filePath);
  const response = await fetch(`${context.settings.url}/api/worker/audio/${encodeURIComponent(audioId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${context.settings.token}`,
      "content-type": "audio/mpeg",
      "x-factory-worker": context.workerId
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function runOfficialPublishJob(context, job) {
  const jobId = job.id || job.jobId;
  const payload = job.payload || {};
  const videos = Array.isArray(payload.videos) ? payload.videos : (payload.generatedVideos || []);
  const local = { results: videos, publishOnly: true, progressCurrent: videos.length, progressTotal: videos.length };
  if (!videos.length) {
    await complete(context, jobId, { error: "没有已生成的成片，无法发布。", result: local, percent: 0 });
    return;
  }
  try {
    if (localJobCancelled(context, job, jobId)) {
      await completeCancelled(context, jobId, local);
      return;
    }
    const published = await submitOfficialPublish(context, job, jobId, local);
    if (localJobCancelled(context, job, jobId)) {
      await completeCancelled(context, jobId, local);
      return;
    }
    await completeOfficialOutcome(context, job, jobId, local, { published });
  } catch (error) {
    if (isOfficialPublishAbort(error) || localJobCancelled(context, job, jobId)) {
      await completeCancelled(context, jobId, local);
      return;
    }
    await completeOfficialOutcome(context, job, jobId, local, { publishError: error.message || "官方发布失败" });
  }
}

async function finishCloudJob(context, job, jobId, local, failed) {
  if (localJobCancelled(context, job, jobId) || isCancelStatus(local.status)) {
    await completeCancelled(context, jobId, local);
    return;
  }
  const videos = Array.isArray(local.results) ? local.results : [];
  if (failed && !videos.length) {
    await complete(context, jobId, {
      error: local.error || local.message || "任务失败",
      message: local.message,
      result: local,
      percent: local.percent
    });
    return;
  }
  if (failed && videos.length) {
    await complete(context, jobId, {
      error: "",
      message: `已出片 ${videos.length} 条，生成未全部完成：${local.error || local.message || "部分失败"}`,
      result: { ...local, publishFailed: true, publishError: local.error || local.message || "生成未全部完成" },
      percent: 100
    });
    return;
  }
  if (shouldOfficialPublish(job.payload) && typeof context.publishOfficial === "function") {
    if (context.cloudSplitPublish) {
      // Free the render slot now; the cloud enqueues an official-publish job
      // that the publish lane picks up with these videos.
      await complete(context, jobId, {
        error: "",
        message: `已出片 ${videos.length} 条，已排队官方发布`,
        result: { ...local, publishPending: true },
        percent: 100
      });
      return;
    }
    try {
      const published = await submitOfficialPublish(context, job, jobId, local);
      if (localJobCancelled(context, job, jobId)) {
        await completeCancelled(context, jobId, local);
        return;
      }
      await completeOfficialOutcome(context, job, jobId, local, { published });
    } catch (error) {
      if (isOfficialPublishAbort(error) || localJobCancelled(context, job, jobId)) {
        await completeCancelled(context, jobId, local);
        return;
      }
      await completeOfficialOutcome(context, job, jobId, local, { publishError: error.message || "官方发布失败" });
    }
    return;
  }
  await complete(context, jobId, {
    error: "",
    message: local.message,
    result: local,
    percent: 100
  });
}

async function submitOfficialPublish(context, job, jobId, local) {
  const videos = Array.isArray(local.results) ? local.results : [];
  mirrorCloudTask(context, job, {
    ...local,
    status: "running",
    percent: 90,
    message: "正在提交 TikTok 官方发布...",
    progressCurrent: 0,
    progressTotal: videos.length
  });
  const taskId = String(job.payload?.taskId || "");
  const existing = readMirroredTask(context, taskId);
  return context.publishOfficial({
    ...(job.payload.publish || {}),
    videos,
    name: job.payload.taskName || job.title,
    taskId: job.payload.taskId,
    officialWaveSize: 10,
    officialUploadConcurrency: 10,
    checkpoint: existing?.officialPublishCheckpoint,
    shouldAbort: () => localJobCancelled(context, job, jobId),
    onCheckpoint: (next) => {
      if (localJobCancelled(context, job, jobId)) return;
      mirrorCloudTask(context, job, {
        ...local,
        ...readMirroredTask(context, taskId),
        status: "running",
        phase: "publishing",
        officialPublishCheckpoint: next
      });
    },
    onProgress: (progress) => {
      mirrorCloudTask(context, job, {
        ...local,
        status: "running",
        phase: "publishing",
        percent: 90,
        message: progress.message || "正在提交 TikTok 官方发布...",
        progressCurrent: videos.length,
        progressTotal: videos.length,
        officialPublishCheckpoint: readMirroredTask(context, taskId)?.officialPublishCheckpoint,
        publishProgress: {
          current: Number(progress.current || 0),
          total: Number(progress.total || videos.length)
        }
      });
    }
  });
}

async function completeOfficialOutcome(context, job, jobId, local, { published, publishError } = {}) {
  const videos = Array.isArray(local.results) ? local.results : [];
  const task = {
    id: job.payload?.taskId || jobId,
    name: job.payload?.taskName || job.title,
    generation: job.payload?.generation || job.payload || {},
    publish: job.payload?.publish || {},
    generatedVideos: videos
  };
  let publishResults = [];
  let publishSummary = null;
  let officialPublishRecords = [];
  if (published) {
    const normalized = normalizeOfficialAutoPublishResult(task, published);
    publishResults = normalized.results;
    publishSummary = normalized.summary;
    officialPublishRecords = buildOfficialPublishRecords(task, publishResults, Date.now(), context.workDir);
    try {
      persistOfficialPublishRecords(context.workDir, task, publishResults);
    } catch {
      // Cloud KV still receives officialPublishRecords; local file backup is optional.
    }
  } else if (publishError) {
    publishResults = videos.map((video, videoIndex) => ({
      recordId: `${task.id}:official:${videoIndex}:failed`,
      dedupeKey: `${task.id}:official:${videoIndex}:failed`,
      status: "failed",
      fileName: String(video.fileName || ""),
      videoIndex,
      message: publishError
    }));
    officialPublishRecords = buildOfficialPublishRecords(task, publishResults, Date.now(), context.workDir);
  }
  const message = publishError
    ? `已出片 ${videos.length} 条，官方发布失败：${publishError}`
    : `出片 ${videos.length} 条，并已提交官方发布。`;
  const outcomeLocal = {
    ...local,
    status: publishError ? "needs_attention" : "done",
    percent: 100,
    message,
    error: "",
    progressCurrent: videos.length,
    progressTotal: videos.length,
    results: videos,
    generatedVideos: videos,
    publishResults,
    publishSummary,
    officialPublishRecords,
    publishFailed: Boolean(publishError),
    publishError: publishError || "",
    generationCompletedAt: Number(local.generationCompletedAt) || Date.now()
  };
  mirrorCloudTask(context, job, outcomeLocal);
  await complete(context, jobId, {
    error: "",
    message,
    result: {
      ...local,
      results: videos,
      publishOnly: Boolean(local.publishOnly),
      publishResults,
      publishSummary,
      officialPublishRecords,
      publishFailed: Boolean(publishError),
      publishError: publishError || ""
    },
    percent: 100
  });
}

function shouldOfficialPublish(payload = {}) {
  const publish = payload.publish && typeof payload.publish === "object" ? payload.publish : {};
  return normalizePublishProvider(publish.provider) === PUBLISH_PROVIDER_OFFICIAL && publish.autoPublish !== false;
}

export function mirrorCloudTask(context, job, local = {}) {
  if (typeof context.mirrorTask !== "function") return;
  const payload = job.payload || {};
  const failed = ["failed", "error", "cancelled", "canceled"].includes(String(local.status || ""));
  const needsAttention = Boolean(local.publishFailed) || String(local.status || "") === "needs_attention";
  const done = ["done", "completed", "success"].includes(String(local.status || "")) && !needsAttention;
  const generatedVideos = Array.isArray(local.results)
    ? local.results
    : (Array.isArray(local.generatedVideos) ? local.generatedVideos : []);
  const publishing = !done && !failed && !needsAttention && (
    local.phase === "publishing"
    || Boolean(local.publishProgress)
    || isOfficialPublishProgressMessage(local.message)
  );
  const mirrored = {
    id: String(payload.taskId || `cloud-${job.id || job.jobId}`),
    name: String(payload.taskName || job.title || "工厂云任务"),
    taskType: payload.taskType || job.type || "reddit-mix",
    status: failed
      ? (String(local.status).startsWith("cancel") ? "canceled" : "failed")
      : needsAttention
        ? "needs_attention"
        : done
          ? "done"
          : "running",
    phase: failed
      ? (String(local.status).startsWith("cancel") ? "canceled" : "failed")
      : needsAttention
        ? "needs_attention"
        : done
          ? (Array.isArray(local.publishResults) ? "done" : "generated")
          : publishing
            ? "publishing"
            : "generating",
    message: local.message || job.message || "工厂云任务执行中",
    error: failed ? (local.error || local.message || "") : "",
    progress: {
      current: publishing
        ? generatedVideos.length
        : Number(local.progressCurrent || local.progress?.current || generatedVideos.length || 0),
      total: publishing
        ? (Number(payload.generation?.totalVideos) || generatedVideos.length || 0)
        : Number(local.progressTotal || local.progress?.total || 0),
      percent: Number(local.percent || local.progress?.percent || 0)
    },
    generation: payload.generation || payload,
    publish: payload.publish || {},
    generatedVideos,
    generationJobId: job.id || job.jobId,
    generationCompletedAt: done ? (Number(local.generationCompletedAt) || Date.now()) : null
  };
  if (local.publishProgress && typeof local.publishProgress === "object") mirrored.publishProgress = local.publishProgress;
  if (Array.isArray(local.publishResults)) mirrored.publishResults = local.publishResults;
  if (local.publishSummary && typeof local.publishSummary === "object") mirrored.publishSummary = local.publishSummary;
  if (Array.isArray(local.officialPublishRecords)) mirrored.officialPublishRecords = local.officialPublishRecords;
  if (done) mirrored.completedAt = Number(local.completedAt) || Date.now();
  if (local.publishFailed != null) mirrored.publishFailed = Boolean(local.publishFailed);
  if (local.publishError) mirrored.publishError = String(local.publishError);
  if (local.officialPublishCheckpoint && typeof local.officialPublishCheckpoint === "object") {
    mirrored.officialPublishCheckpoint = local.officialPublishCheckpoint;
  }
  context.mirrorTask(mirrored);
}

export function isOfficialPublishProgressMessage(message) {
  return /正在(?:并行)?上传|正在提交第|正在提交到|准备提交中台|正在提交 TikTok/.test(String(message || ""));
}

function readMirroredTask(context, taskId) {
  const id = String(taskId || "").trim();
  if (!id || !context?.workDir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(context.workDir, "scheduled-tasks", `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

function resolveJobType(job) {
  const type = String(job.type || "");
  const payload = job.payload || {};
  if (type === "auto-task") {
    if (payload.taskType === "psychology") return "psychology";
    if (payload.taskType === "schulte") return "schulte-batch";
    return "reddit-mix";
  }
  if (type === "schulte" && payload.taskId) return "schulte-batch";
  return type;
}

function buildLocalPayload(job) {
  const raw = job.payload && typeof job.payload === "object" ? job.payload : {};
  const generation = raw.generation && typeof raw.generation === "object" ? raw.generation : {};
  const merged = { ...generation, ...raw, jobId: job.id || job.jobId };
  delete merged.generation;
  return merged;
}

async function syncInventory(context) {
  let redditMixSettings = {};
  try {
    redditMixSettings = JSON.parse(fs.readFileSync(path.join(context.workDir, "reddit-mix-settings.json"), "utf8"));
  } catch {
    redditMixSettings = {};
  }
  const importMarker = path.join(context.workDir, "factory-novel-imported.json");
  const startedAt = Date.now();
  const body = {
    workerId: context.workerId,
    retentionHours: 48,
    officialPublishRecords: recordsChangedSince(readOfficialPublishRecords(context.workDir), context.publishRecordsSyncedAt)
  };
  // A second worker without a local settings file must not blank the cloud copy.
  if (Object.keys(redditMixSettings).length) body.redditMixSettings = redditMixSettings;
  if (!fs.existsSync(importMarker)) {
    const novelContent = readLocalNovelStore(context.workDir);
    // An empty local store (new worker) has nothing to import; skip the merge so
    // the cloud does not rewrite every novel row for no reason.
    if (novelContent.novels.length || novelContent.scripts.length) body.novelContent = novelContent;
  }
  const result = await request(context, "/api/worker/sync", {
    method: "POST",
    body
  });
  if (result?.ok) context.publishRecordsSyncedAt = startedAt;
  if (!fs.existsSync(importMarker) && result?.ok) {
    fs.writeFileSync(importMarker, JSON.stringify({
      importedAt: Date.now(),
      novelImport: result.novelImport || null
    }, null, 2), "utf8");
    console.log("已把本机小说书单导入线上工厂。之后以线上为准，不再回传书单。");
  }
}

async function syncDailyViewData(context) {
  try {
    const result = await pushDailyViewData({ root: context.root, workDir: context.workDir });
    if (!result.skipped) {
      console.log(`已把 ${result.dateKey} 的最新目录数量、素材使用率和发布记录推到线上。`);
    }
  } catch (error) {
    console.error("每日数据推送失败：", error.message || error);
  }
}

function countGroupAssets(group) {
  const indexed = Number(group.totalAssets || (group.assets || []).length || 0);
  if (indexed > 0) return indexed;
  const dir = String(group.sourceDir || group.path || group.dir || "").trim();
  if (!dir || !fs.existsSync(dir)) return 0;
  try {
    return listMediaFiles(dir, VIDEO_EXTENSIONS, { recursive: group.includeSubfolders !== false }).length;
  } catch {
    return 0;
  }
}

function readLocalNovelStore(workDir) {
  try {
    const store = JSON.parse(fs.readFileSync(path.join(workDir, "novel-content-library.json"), "utf8"));
    return {
      novels: Array.isArray(store.novels) ? store.novels : [],
      scripts: Array.isArray(store.scripts) ? store.scripts : []
    };
  } catch {
    return { novels: [], scripts: [] };
  }
}

function readOfficialPublishRecords(workDir) {
  try {
    const records = JSON.parse(fs.readFileSync(path.join(workDir, "publish-records.json"), "utf8"));
    return filterPublishRecordsBySource(records, "official")
      .map((record) => compactOfficialPublishRecord(record))
      .filter((record) => record.id)
      .slice(0, 800);
  } catch {
    return [];
  }
}

// The first sync after start sends everything; later syncs only send records
// touched since the previous successful sync (with a minute of overlap). The
// cloud store also skips unchanged rows, so overlap costs nothing.
export function recordsChangedSince(records, syncedAt = 0) {
  const since = Math.max(0, Number(syncedAt) || 0);
  if (!since) return records;
  const cutoff = since - 60_000;
  return (Array.isArray(records) ? records : []).filter((record) => {
    const touched = Math.max(Number(record?.updatedAt) || 0, Number(record?.createdAt) || 0, (Number(record?.publishedAt) || 0));
    return touched >= cutoff;
  });
}

function compactOfficialPublishRecord(record) {
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
    videoUrl: item.videoUrl || ""
  };
}

export function isCancelStatus(value) {
  return ["cancelled", "canceled"].includes(String(value || "").toLowerCase());
}

export function localJobCancelled(context, job, jobId) {
  const resolvedId = String(jobId || job?.id || job?.jobId || "").trim();
  if (resolvedId) {
    const local = readLocalJob(path.join(context.jobsDir, `${resolvedId}.json`));
    if (isCancelStatus(local.status)) return true;
  }
  const payload = job?.payload && typeof job.payload === "object" ? job.payload : {};
  const taskIds = [payload.taskId, resolvedId ? `cloud-${resolvedId}` : "", resolvedId]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  for (const taskId of taskIds) {
    const fileName = String(taskId).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
    if (!fileName) continue;
    try {
      const task = JSON.parse(fs.readFileSync(path.join(context.workDir, "scheduled-tasks", `${fileName}.json`), "utf8"));
      if (isCancelStatus(task.status)) return true;
    } catch {
      /* no mirrored task yet */
    }
  }
  return false;
}

async function completeCancelled(context, jobId, local = {}) {
  await complete(context, jobId, {
    cancelled: true,
    error: "",
    message: "任务已停止。",
    result: {
      ...local,
      officialPublishRecords: [],
      publishResults: [],
      publishFailed: false,
      publishError: ""
    },
    percent: Number(local.percent || 0)
  });
}

async function abortRunningJob(context, job, jobId, jobPath, child) {
  killProcessTree(child?.pid);
  const local = { ...readLocalJob(jobPath), status: "canceled", message: "任务已停止。" };
  writeLocalJob(jobPath, local);
  mirrorCloudTask(context, job, local);
  await completeCancelled(context, jobId, local);
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

async function complete(context, jobId, body) {
  await request(context, `/api/worker/jobs/${encodeURIComponent(jobId)}/complete`, { method: "POST", body });
}

async function request(context, pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${context.settings.url}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${context.settings.token}`,
      "content-type": "application/json",
      "x-factory-worker": context.workerId
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export const DEFAULT_POLL_MS = 60_000;
export const DEFAULT_SYNC_MS = 300_000;
export const LOCAL_WATCH_MS = 2_000;
export const DAILY_VIEW_DATA_FILE = "factory-daily-data-sync.json";

export function beijingDateKey(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(now));
}

export function dailyViewDataAlreadyPushed(workDir, now = Date.now()) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(workDir, DAILY_VIEW_DATA_FILE), "utf8"));
    return String(marker.dateKey || "") === beijingDateKey(now);
  } catch {
    return false;
  }
}

function collectIndexedAssetGroups(root, config) {
  const libraryRoot = String(config.assetLibraryRoot || "").trim();
  const discovered = discoverAssetLibraryGroups(root, libraryRoot);
  return discovered.length
    ? listAssetGroups(root).filter((group) => discovered.some((item) => item.id === group.id))
    : listAssetGroups(root);
}

function slimAssetCatalogRow(group) {
  return {
    id: group.id,
    name: group.name,
    path: group.path,
    sourceDir: group.sourceDir,
    totalAssets: group.totalAssets,
    clipCount: group.clipCount
  };
}

function latestAssetCatalog(root, config, { limit = 8 } = {}) {
  return publicAssetGroupRows(collectIndexedAssetGroups(root, config))
    .map((group) => {
      let mtime = 0;
      const dir = String(group.sourceDir || group.path || "").trim();
      try {
        if (dir && fs.existsSync(dir)) mtime = fs.statSync(dir).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { group: slimAssetCatalogRow(group), mtime };
    })
    .sort((left, right) => right.mtime - left.mtime || String(left.group.name).localeCompare(String(right.group.name), "zh-Hans-CN"))
    .slice(0, Math.max(1, Number(limit) || 8))
    .map((item) => item.group);
}

function publicAssetGroupRows(groups) {
  return groups.map((group) => {
    const totalAssets = countGroupAssets(group);
    return {
      id: group.id,
      name: group.name,
      path: group.path || group.sourceDir || group.dir || "",
      sourceDir: group.sourceDir || group.path || "",
      totalAssets,
      clipCount: totalAssets,
      totalDuration: Number(group.totalDuration || 0),
      usedAssets: Number(group.usedAssets || 0),
      generatedVideos: Number(group.generatedVideos || 0)
    };
  });
}

export async function pushAssetGroups({ root = process.cwd(), workDir } = {}) {
  const config = readConfig(root);
  const storage = resolveStorageDirs(root, config);
  const resolvedWorkDir = workDir || storage.workDir;
  const settings = loadSettings(resolvedWorkDir);
  if (!settings.url || !settings.token) throw new Error("未配置工厂云工人，无法把素材组同步到线上。");
  const workerId = settings.workerId || `local-${process.platform}-${process.pid}`;
  const groups = publicAssetGroupRows(collectIndexedAssetGroups(root, config));
  await request({ settings, workerId }, "/api/worker/sync", {
    method: "POST",
    body: { workerId, assetGroups: groups }
  });
  return { ok: true, groups, folders: groups.length };
}

export async function pushDailyViewData({ root = process.cwd(), workDir, force = false, now = Date.now() } = {}) {
  const config = readConfig(root);
  const storage = resolveStorageDirs(root, config);
  const resolvedWorkDir = workDir || storage.workDir;
  const dateKey = beijingDateKey(now);
  if (!force && dailyViewDataAlreadyPushed(resolvedWorkDir, now)) return { ok: true, skipped: true, dateKey };
  const settings = loadSettings(resolvedWorkDir);
  if (!settings.url || !settings.token) throw new Error("未配置工厂云工人，无法把今日数据同步到线上。");
  const workerId = settings.workerId || `local-${process.platform}-${process.pid}`;
  const records = readOfficialPublishRecords(resolvedWorkDir);
  const groups = collectIndexedAssetGroups(root, config);
  const assetUsageDashboard = buildAssetUsageSnapshot(root, {
    groupIds: groups.map((group) => group.id),
    publishRecords: records
  });
  const audioGroups = latestAudioCatalog(config);
  const assetGroups = latestAssetCatalog(root, config);
  await request({ settings, workerId }, "/api/worker/sync", {
    method: "POST",
    body: {
      workerId,
      audioGroups,
      assetGroups,
      assetUsageDashboard,
      officialPublishRecords: records
    }
  });
  const result = {
    ok: true,
    skipped: false,
    dateKey,
    groups: assetUsageDashboard.groups?.length || 0,
    audioFolders: audioGroups.length,
    assetFolders: assetGroups.length,
    sampledAt: assetUsageDashboard.sampledAt
  };
  fs.writeFileSync(path.join(resolvedWorkDir, DAILY_VIEW_DATA_FILE), JSON.stringify({
    ...result,
    pushedAt: now
  }, null, 2), "utf8");
  return result;
}

export async function pushAudioGroups({ root = process.cwd(), workDir } = {}) {
  const config = readConfig(root);
  const storage = resolveStorageDirs(root, config);
  const resolvedWorkDir = workDir || storage.workDir;
  const settings = loadSettings(resolvedWorkDir);
  if (!settings.url || !settings.token) throw new Error("未配置工厂云工人，无法把音频目录同步到线上。");
  const workerId = settings.workerId || `local-${process.platform}-${process.pid}`;
  const groups = discoverAudioLibraryGroups(config);
  await request({ settings, workerId }, "/api/worker/sync", {
    method: "POST",
    body: { workerId, audioGroups: groups }
  });
  return {
    ok: true,
    libraryRoot: resolveAudioLibraryRoot(config),
    groups,
    platforms: groups.filter((group) => group.kind === "platform").length,
    folders: groups.length
  };
}

export async function pushAssetUsageDashboard({ root = process.cwd(), workDir, publishRecords } = {}) {
  const config = readConfig(root);
  const storage = resolveStorageDirs(root, config);
  const resolvedWorkDir = workDir || storage.workDir;
  const settings = loadSettings(resolvedWorkDir);
  if (!settings.url || !settings.token) throw new Error("未配置工厂云工人，无法把素材使用率同步到线上。");
  const workerId = settings.workerId || `local-${process.platform}-${process.pid}`;
  const groups = collectIndexedAssetGroups(root, config);
  const records = Array.isArray(publishRecords) ? publishRecords : readOfficialPublishRecords(resolvedWorkDir);
  const assetUsageDashboard = buildAssetUsageSnapshot(root, {
    groupIds: groups.map((group) => group.id),
    publishRecords: records
  });
  await request({ settings, workerId }, "/api/worker/sync", {
    method: "POST",
    body: { workerId, assetUsageDashboard }
  });
  const impact = Object.values(assetUsageDashboard.dashboards || {}).reduce((sum, dash) => {
    const item = dash.impact || {};
    return {
      publishedMatched: sum.publishedMatched + Number(item.publishedMatched || 0),
      withVideoId: sum.withVideoId + Number(item.withVideoId || 0),
      withViews: sum.withViews + Number(item.withViews || 0)
    };
  }, { publishedMatched: 0, withVideoId: 0, withViews: 0 });
  return {
    ok: true,
    sampledAt: assetUsageDashboard.sampledAt,
    groups: assetUsageDashboard.groups?.length || 0,
    ...impact
  };
}

export function loadSettings(workDir) {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(workDir, "factory-cloud-worker.json"), "utf8"));
  } catch {
    file = {};
  }
  return {
    url: String(process.env.FACTORY_CLOUD_URL || file.url || "").replace(/\/+$/, ""),
    token: String(process.env.FACTORY_WORKER_TOKEN || file.token || "").trim(),
    workerId: String(process.env.FACTORY_WORKER_ID || file.workerId || "").trim(),
    pollMs: Number(process.env.FACTORY_WORKER_POLL_MS || file.pollMs || DEFAULT_POLL_MS),
    syncMs: Number(process.env.FACTORY_WORKER_SYNC_MS || file.syncMs || DEFAULT_SYNC_MS),
    renderConcurrency: Number(process.env.FACTORY_WORKER_RENDER_CONCURRENCY || file.renderConcurrency || DEFAULT_RENDER_CONCURRENCY),
    publishConcurrency: Number(process.env.FACTORY_WORKER_PUBLISH_CONCURRENCY || file.publishConcurrency || DEFAULT_PUBLISH_CONCURRENCY),
    renderJobTypes: normalizeJobTypes(process.env.FACTORY_WORKER_RENDER_JOB_TYPES || file.renderJobTypes || []),
    // assignedOnly: only run jobs the task creator pinned to this worker; a
    // second machine with its own asset library must not grab unpinned jobs.
    assignedOnly: parseBoolean(process.env.FACTORY_WORKER_ASSIGNED_ONLY, file.assignedOnly === true),
    label: String(process.env.FACTORY_WORKER_LABEL || file.label || "").trim()
  };
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function writeLocalJob(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function readLocalJob(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { status: "running", percent: 1, message: "等待本地任务文件" };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
const thisFile = path.resolve(fileURLToPath(import.meta.url));
if (invoked && invoked.toLowerCase() === thisFile.toLowerCase()) {
  startFactoryCloudWorker();
}
