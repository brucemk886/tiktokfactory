import assert from "node:assert/strict";
import test from "node:test";
import { applyJobToTask } from "./jobs.js";

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
