import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverAssetLibraryGroups, listAssetGroups, listMediaFiles, VIDEO_EXTENSIONS } from "./asset-library.js";
import { runAudioGenerateJob } from "./audio-generate-job.js";
import { createAudioLibraryService } from "./audio-library.js";
import { discoverAudioLibraryGroups, resolveTargetAudioDir } from "./audio-library-groups.js";
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
  const context = { root, workDir: resolvedWorkDir, jobsDir, settings, workerId, config, mirrorTask, publishOfficial };
  console.log(`工厂云工人已接入：${settings.url}  worker=${workerId}`);
  syncInventory(context).catch((error) => console.error("同步素材组失败：", error.message || error));
  setInterval(() => {
    syncInventory(context).catch((error) => console.error("同步素材组失败：", error.message || error));
  }, settings.syncMs || 60_000);
  loop(context).catch((error) => {
    console.error("工厂云工人退出：", error);
  });
  return { running: true, workerId };
}

async function loop(context) {
  while (true) {
    try {
      const claimed = await request(context, "/api/worker/claim", { method: "POST", body: { workerId: context.workerId } });
      if (claimed.job) await runJob(context, claimed.job);
      else await sleep(context.settings.pollMs || 3000);
    } catch (error) {
      console.error("拉单失败：", error.message || error);
      await sleep(5000);
    }
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
    if (await cloudJobCancelled(context, jobId)) {
      await abortRunningJob(context, job, jobId, jobPath, child);
      break;
    }
    const local = readLocalJob(jobPath);
    const fingerprint = `${local.status}|${local.percent}|${local.message}`;
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      mirrorCloudTask(context, job, local);
      const progress = await request(context, `/api/worker/jobs/${encodeURIComponent(jobId)}/progress`, {
        method: "POST",
        body: {
          percent: local.percent,
          message: local.message,
          status: "running",
          result: local
        }
      }).catch((error) => {
        console.error("回写进度失败：", error.message);
        return {};
      });
      if (progress?.cancelled) {
        await abortRunningJob(context, job, jobId, jobPath, child);
        break;
      }
    }
    if (isCancelStatus(local.status)) {
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
      if (await cloudJobCancelled(context, jobId)) {
        await abortRunningJob(context, job, jobId, jobPath, child);
        break;
      }
      const latest = readLocalJob(jobPath);
      const failed = !["done", "completed", "success"].includes(String(latest.status || ""));
      mirrorCloudTask(context, job, latest);
      await finishCloudJob(context, job, jobId, latest, failed);
      break;
    }
    await sleep(2000);
  }
}

async function runOpeningVariantsJob(context, job) {
  const jobId = job.id || job.jobId;
  const payload = job.payload || {};
  try {
    await request(context, `/api/worker/jobs/${encodeURIComponent(jobId)}/progress`, {
      method: "POST",
      body: { percent: 8, message: `正在用 Codex 生成 ${Array.isArray(payload.styles) ? payload.styles.length : 0} 个改版开头...` }
    });
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
  const count = Array.isArray(payload.items) ? payload.items.length : 0;
  try {
    await request(context, `/api/worker/jobs/${encodeURIComponent(jobId)}/progress`, {
      method: "POST",
      body: { percent: 12, message: `正在单独重写 ${count || 1} 个开头标题...` }
    });
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

async function runAudioEnsureFolderJob(context, job) {
  const jobId = job.id || job.jobId;
  const payload = job.payload || {};
  try {
    const targetAudioDir = resolveTargetAudioDir(context.config, "__novel__", { novelTitle: payload.novelTitle });
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
  const total = Array.isArray(payload.items) ? payload.items.length : 0;
  const library = createAudioLibraryService({
    root: context.root,
    workDir: context.workDir,
    readConfig: () => context.config
  });
  try {
    await request(context, `/api/worker/jobs/${encodeURIComponent(jobId)}/progress`, {
      method: "POST",
      body: { percent: 4, message: total ? `开始生成 ${total} 条小说音频...` : "开始生成小说音频...", result: { progressTotal: total } }
    });
    const result = await runAudioGenerateJob({
      root: context.root,
      workDir: context.workDir,
      config: context.config,
      payload,
      audioLibrary: library,
      onProgress: (progress) => {
        request(context, `/api/worker/jobs/${encodeURIComponent(jobId)}/progress`, {
          method: "POST",
          body: {
            percent: progress.percent || 8,
            message: progress.message || "正在生成小说音频...",
            result: { progressCurrent: progress.current, progressTotal: progress.total }
          }
        }).catch((error) => console.error("回写音频进度失败：", error.message));
      }
    });
    await request(context, `/api/worker/jobs/${encodeURIComponent(jobId)}/progress`, {
      method: "POST",
      body: { percent: 94, message: "ElevenLabs 已出音频，正在传到线上网页..." }
    }).catch((error) => console.error("回写上传进度失败：", error.message));
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
    if (await cloudJobCancelled(context, jobId)) {
      await completeCancelled(context, jobId, local);
      return;
    }
    const published = await submitOfficialPublish(context, job, jobId, local);
    if (await cloudJobCancelled(context, jobId)) {
      await completeCancelled(context, jobId, local);
      return;
    }
    await completeOfficialOutcome(context, job, jobId, local, { published });
  } catch (error) {
    if (isOfficialPublishAbort(error) || await cloudJobCancelled(context, jobId)) {
      await completeCancelled(context, jobId, local);
      return;
    }
    await completeOfficialOutcome(context, job, jobId, local, { publishError: error.message || "官方发布失败" });
  }
}

async function finishCloudJob(context, job, jobId, local, failed) {
  if (await cloudJobCancelled(context, jobId) || isCancelStatus(local.status)) {
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
    try {
      const published = await submitOfficialPublish(context, job, jobId, local);
      if (await cloudJobCancelled(context, jobId)) {
        await completeCancelled(context, jobId, local);
        return;
      }
      await completeOfficialOutcome(context, job, jobId, local, { published });
    } catch (error) {
      if (isOfficialPublishAbort(error) || await cloudJobCancelled(context, jobId)) {
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
  const slimProgress = (progress) => ({
    publishOnly: Boolean(local.publishOnly),
    progressCurrent: videos.length,
    progressTotal: videos.length,
    publishProgress: progress
  });
  try {
    await request(context, `/api/worker/jobs/${encodeURIComponent(jobId)}/progress`, {
      method: "POST",
      body: {
        percent: 90,
        message: "正在提交 TikTok 官方发布...",
        result: slimProgress({ current: 0, total: videos.length, percent: 0 })
      }
    });
  } catch (error) {
    console.error("回写发布进度失败：", error.message);
  }
  return context.publishOfficial({
    ...(job.payload.publish || {}),
    videos,
    name: job.payload.taskName || job.title,
    taskId: job.payload.taskId,
    shouldAbort: () => cloudJobCancelled(context, jobId),
    onProgress: (progress) => {
      request(context, `/api/worker/jobs/${encodeURIComponent(jobId)}/progress`, {
        method: "POST",
        body: {
          percent: 90,
          message: progress.message || "正在提交 TikTok 官方发布...",
          result: slimProgress(progress)
        }
      }).catch((error) => console.error("回写发布进度失败：", error.message));
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
  await complete(context, jobId, {
    error: "",
    message: publishError
      ? `已出片 ${videos.length} 条，官方发布失败：${publishError}`
      : `出片 ${videos.length} 条，并已提交官方发布。`,
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

function mirrorCloudTask(context, job, local = {}) {
  if (typeof context.mirrorTask !== "function") return;
  const payload = job.payload || {};
  const failed = ["failed", "error", "cancelled", "canceled"].includes(String(local.status || ""));
  const done = ["done", "completed", "success"].includes(String(local.status || ""));
  context.mirrorTask({
    id: String(payload.taskId || `cloud-${job.id || job.jobId}`),
    name: String(payload.taskName || job.title || "工厂云任务"),
    taskType: payload.taskType || job.type || "reddit-mix",
    status: failed ? (String(local.status).startsWith("cancel") ? "canceled" : "failed") : done ? "done" : "running",
    phase: failed ? (String(local.status).startsWith("cancel") ? "canceled" : "failed") : done ? "generated" : "generating",
    message: local.message || job.message || "工厂云任务执行中",
    error: failed ? (local.error || local.message || "") : "",
    progress: {
      current: Number(local.progressCurrent || 0),
      total: Number(local.progressTotal || 0),
      percent: Number(local.percent || 0)
    },
    generation: payload.generation || payload,
    publish: payload.publish || {},
    generatedVideos: Array.isArray(local.results) ? local.results : [],
    generationJobId: job.id || job.jobId,
    generationCompletedAt: done ? Date.now() : null
  });
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
  const libraryRoot = String(context.config.assetLibraryRoot || "").trim();
  const discovered = discoverAssetLibraryGroups(context.root, libraryRoot);
  const groups = discovered.length
    ? listAssetGroups(context.root).filter((group) => discovered.some((item) => item.id === group.id))
    : listAssetGroups(context.root);
  let redditMixSettings = {};
  try {
    redditMixSettings = JSON.parse(fs.readFileSync(path.join(context.workDir, "reddit-mix-settings.json"), "utf8"));
  } catch {
    redditMixSettings = {};
  }
  const importMarker = path.join(context.workDir, "factory-novel-imported.json");
  const body = {
    workerId: context.workerId,
    retentionHours: 48,
    assetGroups: groups.map((group) => {
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
    }),
    redditMixSettings,
    audioGroups: discoverAudioLibraryGroups(context.config)
  };
  body.officialPublishRecords = readOfficialPublishRecords(context.workDir);
  if (!fs.existsSync(importMarker)) {
    body.novelContent = readLocalNovelStore(context.workDir);
  }
  const result = await request(context, "/api/worker/sync", {
    method: "POST",
    body
  });
  if (!fs.existsSync(importMarker) && result?.ok) {
    fs.writeFileSync(importMarker, JSON.stringify({
      importedAt: Date.now(),
      novelImport: result.novelImport || null
    }, null, 2), "utf8");
    console.log("已把本机小说书单导入线上工厂。之后以线上为准，不再回传书单。");
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

async function cloudJobCancelled(context, jobId) {
  try {
    const data = await request(context, `/api/worker/jobs/${encodeURIComponent(jobId)}`);
    return Boolean(data?.cancelled || isCancelStatus(data?.job?.status));
  } catch {
    return false;
  }
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

function loadSettings(workDir) {
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
    pollMs: Number(process.env.FACTORY_WORKER_POLL_MS || file.pollMs || 3000),
    syncMs: Number(process.env.FACTORY_WORKER_SYNC_MS || file.syncMs || 60_000)
  };
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
