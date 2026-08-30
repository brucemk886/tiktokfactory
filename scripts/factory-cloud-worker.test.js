import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAutoTaskManager, normalizeOfficialAutoPublishResult } from "./auto-task-manager.js";
import {
  DEFAULT_POLL_MS,
  DEFAULT_SYNC_MS,
  dailyViewDataAlreadyPushed,
  isOfficialPublishProgressMessage,
  loadSettings,
  localJobCancelled,
  mirrorCloudTask,
  pushAssetGroups,
  pushAudioGroups,
  pushDailyViewData
} from "./factory-cloud-worker.js";

test("factory worker requeues its own interrupted jobs on hello", () => {
  const source = fs.readFileSync(new URL("./factory-cloud-worker.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/worker\/hello/);
  assert.match(source, /工人重启，已把/);
  assert.match(source, /mirrorCloudTask\(context, job, outcomeLocal\)/);
  assert.match(source, /assetUsageDashboard = buildAssetUsageSnapshot/);
  assert.match(source, /officialPublishRecords: readOfficialPublishRecords/);
  assert.match(source, /export async function pushAssetUsageDashboard/);
  assert.match(source, /export async function pushAudioGroups/);
  assert.match(source, /export async function pushAssetGroups/);
  assert.match(source, /export async function pushDailyViewData/);
  assert.match(source, /audioGroups: groups/);
  assert.match(source, /latestAudioCatalog/);
  assert.match(source, /latestAssetCatalog/);
  assert.doesNotMatch(source, /audioGroups: discoverAudioLibraryGroups/);
  assert.doesNotMatch(source, /assetUsageDashboard: buildAssetUsageSnapshot\(context/);
  assert.match(source, /checkpoint: existing\?\.officialPublishCheckpoint/);
  assert.match(source, /onCheckpoint:/);
  assert.match(source, /officialPublishCheckpoint: next/);
});

test("official publish progress messages do not treat failure copy as uploading", () => {
  assert.equal(isOfficialPublishProgressMessage("正在提交第 1 波（10 条）到发布中台..."), true);
  assert.equal(isOfficialPublishProgressMessage("正在并行上传 10 条成片（本波 10 条，合计约 240MB）..."), true);
  assert.equal(isOfficialPublishProgressMessage("正在提交 TikTok 官方发布..."), true);
  assert.equal(isOfficialPublishProgressMessage("已出片 40 条，官方发布失败：ECONNRESET"), false);
  assert.equal(isOfficialPublishProgressMessage("出片 40 条，并已提交官方发布。"), false);
});

test("daily view data is marked once per Beijing day", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-daily-view-"));
  assert.equal(dailyViewDataAlreadyPushed(dir), false);
  fs.writeFileSync(path.join(dir, "factory-daily-data-sync.json"), JSON.stringify({ dateKey: "2026-08-29" }));
  assert.equal(dailyViewDataAlreadyPushed(dir, Date.parse("2026-08-29T23:00:00+08:00")), true);
  assert.equal(dailyViewDataAlreadyPushed(dir, Date.parse("2026-08-30T00:30:00+08:00")), false);
});

test("catalog pushes refuse to upload when the factory worker is not configured", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-catalog-sync-"));
  await assert.rejects(() => pushAssetGroups({ root: process.cwd(), workDir: dir }), /未配置工厂云工人/);
  await assert.rejects(() => pushAudioGroups({ root: process.cwd(), workDir: dir }), /未配置工厂云工人/);
  await assert.rejects(() => pushDailyViewData({ root: process.cwd(), workDir: dir, force: true }), /未配置工厂云工人/);
});

test("factory worker claims once a minute and does not poll cloud cancel", () => {
  assert.equal(DEFAULT_POLL_MS, 60_000);
  assert.equal(DEFAULT_SYNC_MS, 300_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-worker-"));
  const settings = loadSettings(dir);
  assert.equal(settings.pollMs, 60_000);
  assert.equal(settings.syncMs, 300_000);
  assert.equal(settings.reconcileMs, undefined);
  assert.equal(settings.progressMinMs, undefined);
});

test("factory worker reads claim interval from the settings file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-worker-"));
  fs.writeFileSync(path.join(dir, "factory-cloud-worker.json"), JSON.stringify({
    pollMs: 90_000,
    syncMs: 120_000
  }));
  const settings = loadSettings(dir);
  assert.equal(settings.pollMs, 90_000);
  assert.equal(settings.syncMs, 120_000);
});

test("local stop is detected from the job file or mirrored task", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-worker-"));
  const jobsDir = path.join(dir, "jobs");
  const tasksDir = path.join(dir, "scheduled-tasks");
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.mkdirSync(tasksDir, { recursive: true });
  const context = { jobsDir, workDir: dir };
  const job = { id: "job-1", payload: { taskId: "task-1" } };
  assert.equal(localJobCancelled(context, job, "job-1"), false);
  fs.writeFileSync(path.join(jobsDir, "job-1.json"), JSON.stringify({ jobId: "job-1", status: "canceled" }));
  assert.equal(localJobCancelled(context, job, "job-1"), true);
  fs.writeFileSync(path.join(jobsDir, "job-2.json"), JSON.stringify({ jobId: "job-2", status: "running" }));
  fs.writeFileSync(path.join(tasksDir, "task-2.json"), JSON.stringify({ id: "task-2", status: "canceled" }));
  assert.equal(localJobCancelled(context, { id: "job-2", payload: { taskId: "task-2" } }, "job-2"), true);
});

test("cancelTask writes the generation job file so the local worker can stop", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-cancel-"));
  const workDir = path.join(dir, "work");
  const outputDir = path.join(dir, "outputs");
  const tasksDir = path.join(workDir, "scheduled-tasks");
  const jobsDir = path.join(workDir, "jobs");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, "cloud-task.json"), JSON.stringify({
    id: "cloud-task",
    source: "factory-cloud",
    status: "running",
    generationJobId: "job-9",
    createdAt: Date.now()
  }));
  const manager = createAutoTaskManager({ root: process.cwd(), workDir, outputDir, publishService: {} });
  const stopped = manager.cancelTask("cloud-task");
  assert.equal(stopped.status, "canceled");
  const job = JSON.parse(fs.readFileSync(path.join(jobsDir, "job-9.json"), "utf8"));
  assert.equal(job.status, "canceled");
});

test("official publish completion remirrors local queue as done with upload results", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-mirror-"));
  const workDir = path.join(dir, "work");
  const outputDir = path.join(dir, "outputs");
  fs.mkdirSync(path.join(workDir, "scheduled-tasks"), { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const manager = createAutoTaskManager({ root: process.cwd(), workDir, outputDir, publishService: {} });
  const publish = {
    provider: "official",
    connectionIds: ["conn-1"],
    officialAccounts: [{ connectionId: "conn-1", username: "demo" }]
  };
  const job = {
    id: "job-official",
    payload: {
      taskId: "task-official",
      taskName: "官方回写",
      taskType: "reddit-mix",
      generation: {},
      publish
    }
  };
  const videos = [{ fileName: "clip.mp4", audioName: "clip.mp3" }];
  const context = { mirrorTask: manager.mirrorExternalTask };
  mirrorCloudTask(context, job, {
    status: "running",
    percent: 90,
    message: "正在提交第 1 波（1 条）到发布中台...",
    progressCurrent: 1,
    progressTotal: 1,
    results: videos
  });
  const running = manager.getTask("task-official");
  assert.equal(running.status, "running");
  assert.equal(running.phase, "publishing");
  assert.equal((running.publishResults || []).length, 0);

  const normalized = normalizeOfficialAutoPublishResult({
    id: "task-official",
    generatedVideos: videos,
    publish
  }, {
    batches: [{
      id: "batch-1",
      tasks: [{
        id: "remote-1",
        connectionId: "conn-1",
        fileName: "clip.mp4",
        externalRef: "clip.mp4:conn-1:0"
      }]
    }]
  });
  mirrorCloudTask(context, job, {
    status: "done",
    percent: 100,
    message: "出片 1 条，并已提交官方发布。",
    progressCurrent: 1,
    progressTotal: 1,
    results: videos,
    publishResults: normalized.results,
    publishSummary: normalized.summary,
    generationCompletedAt: 1_700
  });
  const done = manager.getTask("task-official");
  assert.equal(done.status, "done");
  assert.equal(done.phase, "done");
  assert.equal(done.message, "出片 1 条，并已提交官方发布。");
  assert.equal(done.publishResults.length, 1);
  assert.equal(done.publishResults[0].status, "submitted");
  assert.equal(done.progress.percent, 100);
  assert.equal(done.generationCompletedAt, 1_700);

  mirrorCloudTask(context, job, {
    status: "done",
    publishFailed: true,
    message: "已出片 1 条，官方发布失败：找不到待发布视频：clip.mp4",
    results: videos,
    publishResults: [{ status: "failed", fileName: "clip.mp4" }]
  });
  const failedPublish = manager.getTask("task-official");
  assert.equal(failedPublish.status, "needs_attention");
  assert.equal(failedPublish.phase, "needs_attention");
  assert.equal(failedPublish.publishFailed, true);
});
