import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTikTokCaption } from "./novel-video-badge.js";
import {
  buildOfficialPublishRecords,
  mergeOfficialPublishRecords,
  normalizeOfficialAutoPublishResult,
  persistOfficialPublishRecords,
} from "./auto-task-manager.js";

test("official publish assigns each video to one account in round-robin", () => {
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

  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results.map((item) => item.connectionId), [
    "connection-1",
    "connection-2",
  ]);
  assert.deepEqual(result.results.map((item) => item.scheduleAt), [1_000, 1_000]);
  assert.deepEqual(result.results.map((item) => item.batchIds), [
    ["batch-1"],
    ["batch-1"],
  ]);
  assert.deepEqual(result.summary, {
    total: 2,
    submitted: 2,
    pending: 0,
    failed: 0,
    needsCheck: 0,
    skipped: 0,
  });
  assert.deepEqual(result.results.map((item) => item.status), [
    "submitted",
    "submitted",
  ]);
  assert.deepEqual(result.results.map((item) => item.message), [
    "已提交发布中台",
    "已提交发布中台",
  ]);
});

test("the same account gets later videos at the configured interval", () => {
  const result = normalizeOfficialAutoPublishResult({
    id: "task-interval",
    publish: {
      connectionIds: ["connection-1", "connection-2"],
      scheduleAt: 1_000,
      intervalMinutes: 15,
    },
    generatedVideos: [
      { fileName: "video-1.mp4" },
      { fileName: "video-2.mp4" },
      { fileName: "video-3.mp4" },
      { fileName: "video-4.mp4" },
    ],
  }, {
    batches: [{ id: "batch-1" }],
  });

  assert.deepEqual(result.results.map((item) => item.connectionId), [
    "connection-1",
    "connection-2",
    "connection-1",
    "connection-2",
  ]);
  assert.deepEqual(result.results.map((item) => item.scheduleAt), [1_000, 1_000, 1_900, 1_900]);
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
      audioLibraryId: "audio-1",
      scriptId: "script-1",
      novelId: "novel-1",
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
    audioLibraryId: records[0].audioLibraryId,
    scriptId: records[0].scriptId,
    novelId: records[0].novelId,
    username: records[0].username,
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
    audioLibraryId: "audio-1",
    scriptId: "script-1",
    novelId: "novel-1",
    username: "creator_one",
    status: "submitted",
    scheduleAt: 2_000,
  });
  assert.deepEqual(records[0].taskIds, ["official-batch-1"]);
  assert.equal(records[0].videoDesc, buildTikTokCaption({ audioTitle: "story-1.mp3" }));
});

test("official publish records keep the per-video auto caption", () => {
  const task = {
    id: "task-auto-caption",
    name: "Auto caption task",
    publish: {
      captionMode: "auto",
      connectionIds: ["connection-1"],
      officialAccounts: [{ connectionId: "connection-1", name: "Creator One" }],
      scheduleAt: 2_000,
      videoDesc: "should not be used"
    },
    generatedVideos: [{
      fileName: "video-1.mp4",
      openingTitle: "She married my uncle",
      promotionCopy: "Read the rest on Novel Master.",
      novelPlatform: "NovelMaster",
      videoDesc: "She married my uncle\n\nRead the rest on Novel Master.\n\n#NovelMaster"
    }],
  };
  const normalized = normalizeOfficialAutoPublishResult(task, { batches: [{ id: "batch-auto" }] });
  const records = buildOfficialPublishRecords(task, normalized.results, 123_456);
  assert.equal(records[0].videoDesc, buildTikTokCaption({
    openingTitle: "She married my uncle",
    promotionCopy: "Read the rest on Novel Master.",
    platform: "NovelMaster"
  }));
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

test("cloud publish record merge drops stub summaries and keeps matchable fields", () => {
  const merged = mergeOfficialPublishRecords(
    [
      { id: "old", audioName: "keep.mp3", username: "old_user" },
      { status: "submitted", message: "已提交官方发布 3 条", batchCount: 1 }
    ],
    [
      { id: "new", audioLibraryId: "audio-2", scriptId: "script-2", username: "creator_two", audioName: "story-2.mp3" },
      { status: "submitted", message: "空摘要" }
    ]
  );
  assert.equal(merged.length, 2);
  assert.ok(merged.some((item) => item.id === "old" && item.audioName === "keep.mp3"));
  assert.ok(merged.some((item) => item.id === "new" && item.audioLibraryId === "audio-2" && item.scriptId === "script-2"));
  assert.ok(!merged.some((item) => item.message === "已提交官方发布 3 条"));
});
