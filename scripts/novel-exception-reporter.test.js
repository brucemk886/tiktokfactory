import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ackNovelExceptionEvents,
  backfillUnresolvedNovelTasks,
  enqueueNovelExceptionEvent,
  listPendingNovelExceptionEvents,
  reportOfficialNovelTask,
  reportOfficialPublishRecord,
} from "./novel-exception-reporter.js";

test("reports the 81st failed output without needing the compacted task list", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexc-report-"));
  const results = Array.from({ length: 90 }, (_, index) => ({
    fileName: `clip-${index + 1}.mp4`,
    status: index === 80 ? "failed" : "submitted",
    error: index === 80 ? "encode failed" : "",
    remoteTaskId: `rt-${index + 1}`,
  }));
  const reported = reportOfficialNovelTask(workDir, {
    id: "task-long",
    status: "needs_attention",
    publish: { provider: "official" },
    taskType: "reddit-mix",
    generation: { novelName: "Book" },
    publishResults: results,
    updatedAt: 10,
  });
  assert.ok(reported.events >= 1);
  const pending = listPendingNovelExceptionEvents(workDir, 40);
  assert.ok(pending.some((event) => event.entityId === "rt-81" || event.fileName === "clip-81.mp4"));
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("same event id stays pending once until ACK", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexc-ack-"));
  enqueueNovelExceptionEvent(workDir, { eventId: "e1", kind: "production_failed", observedAt: 1 });
  enqueueNovelExceptionEvent(workDir, { eventId: "e1", kind: "production_failed", observedAt: 2 });
  assert.equal(listPendingNovelExceptionEvents(workDir).length, 1);
  ackNovelExceptionEvents(workDir, ["e1"], 9);
  assert.equal(listPendingNovelExceptionEvents(workDir).length, 0);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("official publish records report the 81st failed video even if the task list was compacted", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexc-record-"));
  const result = reportOfficialPublishRecord(workDir, {
    id: "rec-81",
    provider: "official",
    source: "official-tiktok",
    status: "failed",
    officialRemoteStatus: "failed",
    fileName: "clip-81.mp4",
    remoteTaskId: "rt-81",
    taskId: "task-long",
    updatedAt: 11,
  });
  assert.equal(result.events, 1);
  const pending = listPendingNovelExceptionEvents(workDir);
  assert.ok(pending.some((event) => event.entityId === "rec-81" || event.fileName === "clip-81.mp4"));
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("backfill only takes current unresolved official novel tasks", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexc-backfill-"));
  const result = backfillUnresolvedNovelTasks(workDir, [
    { id: "old-done", status: "done", publish: { provider: "official" }, taskType: "reddit-mix" },
    { id: "canceled", status: "canceled", publish: { provider: "official" }, taskType: "reddit-mix" },
    { id: "live-fail", status: "failed", publish: { provider: "official" }, taskType: "reddit-mix", updatedAt: 3, message: "boom" },
  ]);
  assert.ok(result.reported >= 1);
  const pending = listPendingNovelExceptionEvents(workDir);
  assert.ok(pending.some((event) => event.localTaskId === "live-fail"));
  assert.ok(!pending.some((event) => event.localTaskId === "old-done"));
  fs.rmSync(workDir, { recursive: true, force: true });
});
