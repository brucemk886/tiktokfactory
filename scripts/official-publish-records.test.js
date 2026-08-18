import assert from "node:assert/strict";
import test from "node:test";
import { mergeOfficialPublishRecords, normalizeOfficialPublishRecord, summarizeOfficialPublishRecords } from "./official-publish-records.js";

test("normalizes slim worker records for the official publish table", () => {
  const record = normalizeOfficialPublishRecord({
    id: "r1",
    username: "creator_one",
    publishedAt: Date.parse("2026-08-17T12:00:00+08:00"),
    videoId: "1234567890",
    audioName: "第一章.mp3"
  });
  assert.equal(record.accountName, "creator_one");
  assert.equal(record.accountUsername, "creator_one");
  assert.equal(record.fileName, "第一章.mp3");
  assert.equal(record.status, "published");
  assert.ok(record.createdAt > 0);
  assert.ok(record.scheduleAt > 0);
});

test("merge keeps rich fields when a slimmer sync arrives", () => {
  const merged = mergeOfficialPublishRecords([
    { id: "r1", accountName: "Creator One", fileName: "cut-1.mp4", createdAt: 1_700_000_000_000, status: "submitted", connectionId: "acc-1", videoId: "v1" }
  ], [
    { id: "r1", username: "creator_one", videoId: "v1", publishedAt: 1_700_000_100_000 }
  ]);
  assert.equal(merged[0].accountName, "Creator One");
  assert.equal(merged[0].fileName, "cut-1.mp4");
  assert.equal(merged[0].status, "submitted");
  assert.equal(merged[0].connectionId, "acc-1");
});

test("summary uses normalized fields and range", () => {
  const now = Date.parse("2026-08-18T18:00:00+08:00");
  const page = summarizeOfficialPublishRecords([
    { id: "old", username: "a", publishedAt: now - 10 * 86_400_000, videoId: "1" },
    { id: "fresh", username: "b", publishedAt: now - 2 * 86_400_000, videoId: "2", status: "submitted" }
  ], { range: "7d" });
  assert.equal(page.summary.recordCount, 1);
  assert.equal(page.summary.accountCount, 1);
  assert.equal(page.summary.submittedCount, 1);
  assert.equal(page.records[0].accountName, "b");
});
