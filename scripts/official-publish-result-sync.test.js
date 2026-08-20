import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOfficialPublishResultSync, nextBeijingRun, selectDueOfficialPublishRecords } from "./official-publish-result-sync.js";

const SHANGHAI_MORNING = Date.parse("2026-08-12T10:00:00+08:00");

test("official result sync schedules the next run at 08:30 Beijing time", () => {
  assert.equal(
    nextBeijingRun(Date.parse("2026-08-12T08:29:59+08:00"), 8, 30),
    Date.parse("2026-08-12T08:30:00+08:00"),
  );
  assert.equal(
    nextBeijingRun(Date.parse("2026-08-12T08:30:00+08:00"), 8, 30),
    Date.parse("2026-08-13T08:30:00+08:00"),
  );
});

test("official result sync only selects records on a later Beijing calendar day", () => {
  const records = [
    officialRecord("yesterday", "2026-08-11T23:50:00+08:00"),
    officialRecord("today", "2026-08-12T00:01:00+08:00"),
    officialRecord("next-week", "2026-08-19T10:00:00+08:00"),
    { ...officialRecord("geelark", "2026-08-11T10:00:00+08:00"), provider: "geelark", source: "geelark" },
  ];
  assert.deepEqual(selectDueOfficialPublishRecords(records, SHANGHAI_MORNING).map((record) => record.id), ["yesterday"]);
});

test("daily sync groups batch requests and writes video id plus detailed official data", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-result-sync-"));
  let records = [
    officialRecord("record-1", "2026-08-11T10:00:00+08:00", { externalRef: "video-1:connection-1:0" }),
    officialRecord("record-2", "2026-08-11T10:15:00+08:00", { externalRef: "video-2:connection-1:1" }),
  ];
  let batchCalls = 0;
  let detailCalls = 0;
  const service = {
    async getPublishBatch() {
      batchCalls += 1;
      return { batch: { tasks: [
        remoteTask("task-1", "video-1:connection-1:0", "700000000000000001"),
        remoteTask("task-2", "video-2:connection-1:1", "700000000000000002"),
      ] } };
    },
    async listVideos({ schema, limit, includePrivate, includeHistory, snapshotDays }) {
      detailCalls += 1;
      assert.equal(schema, "tiktok:connection-1");
      assert.equal(limit, 100);
      assert.equal(includePrivate, true);
      assert.equal(includeHistory, true);
      assert.equal(snapshotDays, 400);
      return { videos: [
        { id: "700000000000000001", views: 123, snapshots: [{ snapshotDate: "2026-08-12", syncedAt: SHANGHAI_MORNING, views: 123 }] },
        { id: "700000000000000002", views: 456, snapshots: [{ snapshotDate: "2026-08-12", syncedAt: SHANGHAI_MORNING, views: 456 }] },
      ], profile: { username: "creator" }, profileSnapshots: [{ snapshotDate: "2026-08-12", syncedAt: SHANGHAI_MORNING, followers: 20 }] };
    },
  };
  const sync = createOfficialPublishResultSync({
    workDir,
    service,
    readRecords: () => records,
    writeRecords: (next) => { records = next; },
    now: () => SHANGHAI_MORNING,
    requestIntervalMs: 0,
  });

  const result = await sync.run();

  assert.equal(batchCalls, 1);
  assert.equal(detailCalls, 1);
  assert.equal(result.published, 2);
  assert.equal(result.details, 2);
  assert.deepEqual(records.map((record) => record.videoId), ["700000000000000001", "700000000000000002"]);
  assert.ok(records.every((record) => record.status === "published" && record.officialVideoDetailStatus === "synced"));
  assert.equal(records[0].officialVideo.views, 123);
  assert.equal(records[0].officialVideoSnapshots[0].views, 123);
  assert.equal(records[0].officialAccountSnapshots[0].followers, 20);
});

test("daily sync writes TikTok handle and fail_reason onto failed records", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-result-fail-"));
  let records = [
    officialRecord("record-fail", "2026-08-11T10:00:00+08:00", {
      externalRef: "cut-1.mp4:acc-1:0",
      connectionId: "acc-1",
      fileName: "cut-1.mp4",
      accountName: "leonardoduan",
    }),
  ];
  const sync = createOfficialPublishResultSync({
    workDir,
    service: {
      async getPublishBatch() {
        return { batch: { tasks: [{
          id: "t1",
          externalRef: "cut-1.mp4:acc-1:0",
          connectionId: "acc-1",
          fileName: "cut-1.mp4",
          status: "failed",
          error: "spam_risk",
          username: "dominicktown39",
        }] } };
      },
      async listVideos() { return { videos: [] }; },
    },
    readRecords: () => records,
    writeRecords: (next) => { records = next; },
    now: () => SHANGHAI_MORNING,
    requestIntervalMs: 0,
  });
  const result = await sync.run();
  assert.equal(result.failed, 1);
  assert.equal(records[0].status, "failed");
  assert.equal(records[0].accountUsername, "dominicktown39");
  assert.equal(records[0].publishError, "spam_risk");
  assert.equal(records[0].note, "TikTok 拒绝：spam_risk");
});

test("published records without stored video detail are retried on a later daily run", () => {
  const record = officialRecord("published", "2026-08-10T10:00:00+08:00", { status: "published", videoId: "700000000000000003", officialVideoDetailStatus: "pending" });
  assert.deepEqual(selectDueOfficialPublishRecords([record], SHANGHAI_MORNING).map((item) => item.id), ["published"]);
  assert.equal(selectDueOfficialPublishRecords([{ ...record, officialVideoDetailStatus: "synced" }], SHANGHAI_MORNING).length, 1);
  assert.equal(selectDueOfficialPublishRecords([{
    ...record,
    officialVideoDetailStatus: "synced",
    officialVideoSnapshots: [{ snapshotDate: "2026-08-12", syncedAt: SHANGHAI_MORNING }],
  }], SHANGHAI_MORNING).length, 0);
});

function officialRecord(id, scheduleIso, extra = {}) {
  return {
    id,
    provider: "official",
    source: "official-tiktok",
    status: "submitted",
    scheduleAt: Math.floor(Date.parse(scheduleIso) / 1000),
    createdAt: Date.parse(scheduleIso),
    batchId: "batch-1",
    officialBatchIds: ["batch-1"],
    connectionId: "connection-1",
    fileName: `${id}.mp4`,
    externalRef: id,
    ...extra,
  };
}

function remoteTask(id, externalRef, videoId) {
  return {
    id,
    externalRef,
    connectionId: "connection-1",
    status: "published",
    publishId: `publish-${id}`,
    videoId,
    videoUrl: `https://www.tiktok.com/video/${videoId}`,
    submittedAt: SHANGHAI_MORNING - 120_000,
    completedAt: SHANGHAI_MORNING - 60_000,
    publishedAt: SHANGHAI_MORNING - 90_000,
  };
}
