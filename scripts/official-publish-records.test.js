import assert from "node:assert/strict";
import test from "node:test";
import { applyOfficialRemoteOutcome, attachOfficialRemoteOutcomes, hydrateOfficialPublishRecords, mergeOfficialPublishRecords, normalizeOfficialPublishRecord, officialFailReasonLabel, summarizeOfficialPublishRecords } from "./official-publish-records.js";

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

test("fail reason labels keep TikTok short codes and explain the generic spam_risk bucket", () => {
  assert.match(officialFailReasonLabel("spam_risk"), /没有更细原因/);
  assert.match(officialFailReasonLabel("spam_risk_text"), /文案/);
  assert.equal(officialFailReasonLabel("unknown_code"), "unknown_code");
});

test("remote outcome keeps the TikTok handle and spam_risk reason", () => {
  const next = applyOfficialRemoteOutcome({
    id: "r1",
    accountName: "leonardoduan",
    accountUsername: "dominicktown39",
    status: "submitted",
    note: "已提交发布中台",
    fileName: "cut-1.mp4",
    connectionId: "acc-1"
  }, {
    status: "failed",
    error: "spam_risk",
    username: "dominicktown39",
    fileName: "cut-1.mp4",
    connectionId: "acc-1"
  });
  assert.equal(next.status, "failed");
  assert.equal(next.accountUsername, "dominicktown39");
  assert.equal(next.publishError, "spam_risk");
  assert.equal(next.note, "TikTok 拒绝：TikTok 审核判定这次发布有风险，没有更细原因，官方要求不要重试（spam_risk）");
});

test("attaches remote outcomes from a live batch payload", () => {
  const records = attachOfficialRemoteOutcomes([
    { id: "r1", remoteTaskId: "t1", accountName: "kathrynkan", accountUsername: "", status: "submitted" }
  ], [{
    tasks: [{ id: "t1", username: "kathrynkan86", status: "failed", error: "spam_risk" }]
  }]);
  assert.equal(records[0].accountUsername, "kathrynkan86");
  assert.equal(records[0].publishError, "spam_risk");
});

test("empty externalRef does not attach the first remote task to every record", () => {
  const records = attachOfficialRemoteOutcomes([
    { id: "r1", accountName: "kathrynkan", accountUsername: "", status: "submitted", connectionId: "acc-1", fileName: "cut-1.mp4" },
    { id: "r2", accountName: "ofelialaw", accountUsername: "", status: "submitted", connectionId: "acc-2", fileName: "cut-2.mp4" }
  ], [{
    tasks: [
      { id: "t1", username: "kathrynkan86", status: "failed", error: "spam_risk", connectionId: "acc-1", fileName: "cut-1.mp4" },
      { id: "t2", username: "ofelialaw64308", status: "published", connectionId: "acc-2", fileName: "cut-2.mp4" }
    ]
  }]);
  assert.equal(records[0].accountUsername, "kathrynkan86");
  assert.equal(records[0].status, "failed");
  assert.equal(records[1].accountUsername, "ofelialaw64308");
  assert.equal(records[1].status, "published");
});

test("hydrate pulls live batch tasks and maps TikTok handles", async () => {
  const records = await hydrateOfficialPublishRecords([
    {
      id: "r1",
      batchId: "a9bf8e63-4607-4281-9582-42c6cb763cea",
      accountName: "leonardoduan",
      status: "submitted",
      connectionId: "acc-1",
      fileName: "cut-1.mp4"
    }
  ], async (batchId) => ({
    batch: {
      id: batchId,
      tasks: [{
        connectionId: "acc-1",
        fileName: "cut-1.mp4",
        username: "dominicktown39",
        status: "failed",
        error: "spam_risk"
      }]
    }
  }));
  assert.equal(records[0].accountUsername, "dominicktown39");
  assert.equal(records[0].publishError, "spam_risk");
  assert.equal(records[0].status, "failed");
});
