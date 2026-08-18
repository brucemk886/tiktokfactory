import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverAssetLibraryGroups, listAssetGroups } from "./asset-library.js";
import { filterPublishRecordsBySource } from "./publish-record-sources.js";
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

export function startFactoryCloudWorker({ root = process.cwd(), workDir, mirrorTask } = {}) {
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
  const context = { root, workDir: resolvedWorkDir, jobsDir, settings, workerId, config, mirrorTask };
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
      await request(context, `/api/worker/jobs/${encodeURIComponent(jobId)}/progress`, {
        method: "POST",
        body: {
          percent: local.percent,
          message: local.message,
          status: "running",
          result: local
        }
      }).catch((error) => console.error("回写进度失败：", error.message));
    }
    if (["done", "completed", "success", "failed", "error", "cancelled", "canceled"].includes(String(local.status || ""))) {
      const failed = ["failed", "error", "cancelled", "canceled"].includes(String(local.status || ""));
      mirrorCloudTask(context, job, local);
      await complete(context, jobId, {
        error: failed ? (local.error || local.message || "任务失败") : "",
        message: local.message,
        result: local,
        percent: local.percent
      });
      break;
    }
    if (child.exitCode !== null) {
      await sleep(1500);
      const latest = readLocalJob(jobPath);
      if (["done", "completed", "success"].includes(String(latest.status || ""))) {
        await complete(context, jobId, { message: latest.message, result: latest, percent: 100 });
      } else {
        await complete(context, jobId, { error: latest.error || `工人进程退出 ${child.exitCode}`, result: latest });
      }
      break;
    }
    await sleep(2000);
  }
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
    assetGroups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      path: group.path || group.dir || "",
      clipCount: Number(group.clipCount || group.assetCount || (group.assets || []).length || 0)
    })),
    redditMixSettings
  };
  if (!fs.existsSync(importMarker)) {
    body.novelContent = readLocalNovelStore(context.workDir);
    body.officialPublishRecords = readOfficialPublishRecords(context.workDir);
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
    return filterPublishRecordsBySource(records, "official").map((record) => ({
      id: record.id || record.taskId || record.jobId || "",
      videoId: record.videoId || record.tiktokVideoId || record.itemId || "",
      username: record.username || record.accountName || record.tiktokUsername || "",
      publishedAt: record.publishedAt || record.actualPublishedAt || record.publishTime || 0,
      audioLibraryId: record.audioLibraryId || record.audioId || "",
      sourceAudioId: record.sourceAudioId || "",
      audioName: record.audioName || record.audioFileName || "",
      scriptId: record.scriptId || "",
      novelId: record.novelId || "",
    })).filter((record) => record.videoId || record.audioLibraryId || record.scriptId).slice(0, 3000);
  } catch {
    return [];
  }
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
