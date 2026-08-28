import assert from "node:assert/strict";
import test from "node:test";
import { applyJobToTask, completeJobNextStatus, findLatestOpeningVariantsJob, isCancelledJob, isDeletedTask, isOrphanRunningJob, persistableJobResult, shouldWriteOfficialPublishRecords } from "./jobs.js";

test("publish failure after generation keeps videos and needs attention", () => {
  const task = applyJobToTask({
    id: "task-1",
    generatedVideos: [],
    publishResults: []
  }, {
    id: "job-1",
    type: "reddit-mix",
    status: "done",
    message: "已出片 2 条，官方发布失败：缺少账号",
    error: "",
    result_json: JSON.stringify({
      results: [{ fileName: "a.mp4" }, { fileName: "b.mp4" }],
      progressCurrent: 2,
      progressTotal: 2,
      publishFailed: true,
      publishError: "缺少账号",
      publishResults: [{ status: "failed", fileName: "a.mp4", message: "缺少账号" }]
    }),
    updated_at: 10,
    completed_at: 10
  });
  assert.equal(task.status, "needs_attention");
  assert.equal(task.phase, "needs_attention");
  assert.equal(task.error, "");
  assert.equal(task.publishError, "缺少账号");
  assert.equal(task.generatedVideos.length, 2);
});

test("retry publish does not wipe generated videos", () => {
  const task = applyJobToTask({
    id: "task-1",
    generatedVideos: [{ fileName: "a.mp4" }],
    publishResults: [{ status: "failed" }]
  }, {
    id: "job-2",
    type: "official-publish",
    status: "running",
    message: "正在提交 TikTok 官方发布...",
    result_json: JSON.stringify({ publishOnly: true, publishProgress: { current: 0, total: 1 } }),
    updated_at: 11
  });
  assert.equal(task.status, "running");
  assert.equal(task.phase, "publishing");
  assert.deepEqual(task.generatedVideos, [{ fileName: "a.mp4" }]);
});

test("deleted task is not resurrected by job status", () => {
  const task = applyJobToTask({
    id: "task-1",
    deleted: 1,
    status: "deleted",
    generatedVideos: [{ fileName: "a.mp4" }]
  }, {
    id: "job-1",
    type: "reddit-mix",
    status: "done",
    message: "完成",
    result_json: JSON.stringify({ results: [{ fileName: "a.mp4" }], publishFailed: true }),
    updated_at: 12,
    completed_at: 12
  });
  assert.equal(isDeletedTask(task), true);
  assert.equal(task.status, "deleted");
  assert.equal(task.deleted, 1);
});

test("expected count stays at planned total while videos are still generating", () => {
  const task = applyJobToTask({
    id: "task-1",
    expectedVideoCount: 6,
    generation: { totalVideos: 6 },
    generatedVideos: [{ fileName: "a.mp4" }],
    progress: { current: 1, total: 6 }
  }, {
    id: "job-1",
    type: "reddit-mix",
    status: "running",
    percent: 20,
    message: "已完成 2/6",
    result_json: JSON.stringify({
      results: [{ fileName: "a.mp4" }, { fileName: "b.mp4" }],
      progressCurrent: 2,
      progressTotal: 6
    }),
    updated_at: 13
  });
  assert.equal(task.expectedVideoCount, 6);
  assert.equal(task.progress.total, 6);
  assert.equal(task.generatedVideos.length, 2);
});

test("stop keeps the task canceled and does not write publish records", () => {
  const task = applyJobToTask({
    id: "task-1",
    status: "canceled",
    generationJobId: "job-1",
    generatedVideos: [{ fileName: "a.mp4" }],
    publishResults: []
  }, {
    id: "job-1",
    type: "reddit-mix",
    status: "done",
    message: "出片 1 条，并已提交官方发布。",
    result_json: JSON.stringify({
      results: [{ fileName: "a.mp4" }],
      officialPublishRecords: [{ id: "r1" }],
      publishResults: [{ status: "submitted", fileName: "a.mp4" }]
    }),
    updated_at: 20,
    completed_at: 20
  });
  assert.equal(task.status, "canceled");
  assert.equal(task.phase, "canceled");
  assert.deepEqual(task.publishResults, []);
  assert.equal(completeJobNextStatus({ existingStatus: "cancelled", failed: false }), "cancelled");
  assert.equal(completeJobNextStatus({ cancelled: true, failed: false }), "cancelled");
  assert.equal(shouldWriteOfficialPublishRecords({
    existingStatus: "cancelled",
    cancelled: true,
    records: [{ id: "r1" }]
  }), false);
  assert.equal(isCancelledJob({ status: "cancelled" }), true);
});

test("worker restart requeues only its own running jobs", () => {
  assert.equal(isOrphanRunningJob({ status: "running", worker_id: "windows-local" }, "windows-local"), true);
  assert.equal(isOrphanRunningJob({ status: "queued", worker_id: "windows-local" }, "windows-local"), false);
  assert.equal(isOrphanRunningJob({ status: "running", worker_id: "other" }, "windows-local"), false);
  assert.equal(isOrphanRunningJob({ status: "cancelled", worker_id: "windows-local" }, "windows-local"), false);
});

test("opening variants survive job-result persistence", () => {
  const result = persistableJobResult({
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    variants: [{
      style: "smart-strongest",
      styleLabel: "智能最强钩子",
      title: "The tenants bankrupted me",
      openingTitle: "They Bankrupted Their Dream Landlord",
      script: "My tenants sued me into bankruptcy.",
      titleZh: "租客让我破产",
      openingTitleZh: "他们让梦想房东破产",
      scriptZh: "我的租客把我告到破产。"
    }]
  });
  assert.equal(result.model, "gpt-5.6-sol");
  assert.equal(result.reasoningEffort, "xhigh");
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].style, "smart-strongest");
  assert.match(result.variants[0].script, /bankruptcy/);
  assert.match(result.variants[0].scriptZh, /破产/);
});

test("opening titles survive job-result persistence", () => {
  const result = persistableJobResult({
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    titles: [{
      id: "variant-1",
      openingTitle: "They Staged Their Rescue",
      openingTitleZh: "这场救援是它们布置的"
    }]
  });
  assert.equal(result.titles.length, 1);
  assert.equal(result.titles[0].id, "variant-1");
  assert.match(result.titles[0].openingTitle, /Rescue/);
});

test("latest opening-variant lookup returns the newest matching novel for the current user", async () => {
  const rows = [
    { id: "job-other", payload_json: JSON.stringify({ novelId: "novel-2" }) },
    { id: "job-match", payload_json: JSON.stringify({ novelId: "novel-1" }) }
  ];
  const db = {
    prepare() {
      return {
        bind(username, createdAfter) {
          assert.equal(username, "admin");
          assert.ok(Number.isFinite(createdAfter));
          return { all: async () => ({ results: rows }) };
        }
      };
    }
  };
  const job = await findLatestOpeningVariantsJob(db, { novelId: "novel-1", createdBy: "admin" });
  assert.equal(job.id, "job-match");
});

test("worker audio upload route is wired for generate-time cloud playback", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./jobs.js", import.meta.url), "utf8");
  assert.match(source, /putNovelAudio/);
  assert.match(source, /worker\\\/audio/);
});
