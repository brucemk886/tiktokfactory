import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildOfficialPublishRecords,
  normalizeOfficialAutoPublishResult,
  persistOfficialPublishRecords,
} from "./auto-task-manager.js";

test("official publish result records every video and account at video-based intervals", () => {
  const result = normalizeOfficialAutoPublishResult({
    id: "task-1",
    publish: {
      connectionIds: ["connection-1", "connection-2"],
      scheduleAt: 1_000,
      intervalMinutes: 15,
    },
    generatedVideos: [
      { fileName: "video-1.mp4" },
      { fileName: "video-2.mp4" },
    ],
  }, {
    batches: [{ id: "batch-1" }],
  });

  assert.equal(result.results.length, 4);
  assert.deepEqual(result.results.map((item) => item.connectionId), [
    "connection-1",
    "connection-2",
    "connection-1",
    "connection-2",
  ]);
  assert.deepEqual(result.results.map((item) => item.scheduleAt), [1_000, 1_000, 1_900, 1_900]);
  assert.deepEqual(result.results.map((item) => item.batchIds), [
    ["batch-1"],
    ["batch-1"],
    ["batch-1"],
    ["batch-1"],
  ]);
  assert.deepEqual(result.summary, {
    total: 4,
    submitted: 4,
    pending: 0,
    failed: 0,
    needsCheck: 0,
    skipped: 0,
  });
  assert.deepEqual(result.results.map((item) => item.status), [
    "submitted",
    "submitted",
    "submitted",
    "submitted",
  ]);
  assert.deepEqual(result.results.map((item) => item.message), [
    "已提交发布中台",
    "已提交发布中台",
    "已提交发布中台",
    "已提交发布中台",
  ]);
});

test("official publish results map to the shared publish-record schema", () => {
  const task = {
    id: "task-records",
    name: "Official publish task",
    ownerUserId: "admin-user",
    geelarkProfileId: "default",
    publish: {
      connectionIds: ["connection-1"],
      officialAccounts: [{ connectionId: "connection-1", name: "Creator One", username: "creator_one" }],
      scheduleAt: 2_000,
      intervalMinutes: 15,
      videoDesc: "#reddit",
    },
    generatedVideos: [{
      fileName: "video-1.mp4",
      audioName: "story-1.mp3",
      template: "reddit-mix",
      templateLabel: "Reddit 混剪",
      variant: 2,
    }],
  };
  const normalized = normalizeOfficialAutoPublishResult(task, { batches: [{ id: "official-batch-1" }] });
  const records = buildOfficialPublishRecords(task, normalized.results, 123_456);

  assert.equal(records.length, 1);
  assert.deepEqual({
    id: records[0].id,
    source: records[0].source,
    provider: records[0].provider,
    ownerUserId: records[0].ownerUserId,
    assignedEnvId: records[0].assignedEnvId,
    accountName: records[0].accountName,
    accountUsername: records[0].accountUsername,
    groupName: records[0].groupName,
    fileName: records[0].fileName,
    audioName: records[0].audioName,
    status: records[0].status,
    scheduleAt: records[0].scheduleAt,
  }, {
    id: "task-records:official:0:connection-1",
    source: "official-tiktok",
    provider: "official",
    ownerUserId: "admin-user",
    assignedEnvId: "connection-1",
    accountName: "Creator One",
    accountUsername: "creator_one",
    groupName: "TikTok 官方 API",
    fileName: "video-1.mp4",
    audioName: "story-1.mp3",
    status: "submitted",
    scheduleAt: 2_000,
  });
  assert.deepEqual(records[0].taskIds, ["official-batch-1"]);
});

test("official publish record persistence is idempotent", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-publish-records-"));
  try {
    const task = {
      id: "task-idempotent",
      publish: {
        connectionIds: ["connection-1"],
        officialAccounts: [{ connectionId: "connection-1", name: "Creator One" }],
        scheduleAt: 3_000,
      },
      generatedVideos: [{ fileName: "video-1.mp4" }],
    };
    const normalized = normalizeOfficialAutoPublishResult(task, { batches: [{ id: "batch-1" }] });
    persistOfficialPublishRecords(workDir, task, normalized.results);
    persistOfficialPublishRecords(workDir, task, normalized.results);

    const records = JSON.parse(fs.readFileSync(path.join(workDir, "publish-records.json"), "utf8"));
    assert.equal(records.length, 1);
    assert.equal(records[0].id, "task-idempotent:official:0:connection-1");
    assert.equal(records[0].accountName, "Creator One");
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
