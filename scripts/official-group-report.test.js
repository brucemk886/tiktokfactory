import assert from "node:assert/strict";
import test from "node:test";
import { attachPublishOutcome, computeGroupReport, connectionIdsFromArchiveRows, mergePublishStats, periodWindow, shanghaiDateKey, snapshotDateKey } from "./official-group-report.js";

test("classifies today videos into zero, low and high view buckets", () => {
  const now = Date.parse("2026-08-18T12:00:00+08:00");
  const createdAt = Date.parse("2026-08-18T09:00:00+08:00");
  const report = computeGroupReport({
    group: { id: "g1", name: "A组", reportEnabled: true },
    project: { id: "p1", name: "小说推文" },
    period: "today",
    now,
    videos: [
      { id: "v0", username: "a", title: "零播", views: 0, createdAt },
      { id: "v1", username: "a", title: "低播", views: 80, createdAt },
      { id: "v2", username: "b", title: "高播", views: 1600, createdAt },
      { id: "v3", username: "c", title: "昨天", views: 0, createdAt: createdAt - 86_400_000 },
    ],
    accounts: [{ username: "a" }, { username: "b" }],
  });
  assert.equal(report.summary.published, 3);
  assert.equal(report.summary.zeroView, 1);
  assert.equal(report.summary.lowView, 1);
  assert.equal(report.summary.highView, 1);
  assert.equal(report.summary.views, 1680);
  assert.equal(report.summary.avgView, 560);
  assert.equal(report.anomalyAccounts[0].username, "a");
  assert.equal(report.buckets.highView[0].id, "v2");
});

test("custom date range only includes videos in the selected days", () => {
  const report = computeGroupReport({
    group: { id: "g1", name: "A组" },
    project: { id: "p1", name: "小说推文" },
    fromKey: "2026-08-16",
    toKey: "2026-08-17",
    videos: [
      { id: "v1", username: "a", title: "范围内", views: 400, createdAt: Date.parse("2026-08-16T09:00:00+08:00") },
      { id: "v2", username: "a", title: "范围内", views: 200, createdAt: Date.parse("2026-08-17T21:00:00+08:00") },
      { id: "v3", username: "a", title: "范围外", views: 9000, createdAt: Date.parse("2026-08-18T09:00:00+08:00") },
    ],
  });
  assert.equal(report.summary.published, 2);
  assert.equal(report.summary.avgView, 300);
  assert.equal(report.fromKey, "2026-08-16");
  assert.equal(report.toKey, "2026-08-17");
});

test("attaches hub publish outcomes without changing archive video counts", () => {
  const report = computeGroupReport({
    group: { id: "g1", name: "A组" },
    project: { id: "p1", name: "小说推文" },
    period: "today",
    now: Date.parse("2026-08-18T12:00:00+08:00"),
    videos: [{ id: "v1", username: "a", title: "片", views: 80, createdAt: Date.parse("2026-08-18T09:00:00+08:00") }],
  });
  const next = attachPublishOutcome(report, { success: 92, failed: 14, riskAccounts: 7 });
  assert.equal(next.summary.published, 1);
  assert.equal(next.summary.publishSuccess, 92);
  assert.equal(next.summary.publishFailed, 14);
  assert.equal(next.summary.riskAccountCount, 7);
  assert.deepEqual(connectionIdsFromArchiveRows([
    { account_key: "tiktok:conn-1" },
    { schema: "tiktok:conn-1" },
    { accountKey: "local-only" },
  ]), ["conn-1"]);
  assert.deepEqual(mergePublishStats([
    { success: 90, failed: 10, riskAccounts: 6 },
    { success: 2, failed: 4, riskAccounts: 1 },
  ]), { success: 92, failed: 14, riskAccounts: 7, pendingIngest: 0 });
});

test("week window starts on Monday in Shanghai", () => {
  const sunday = Date.parse("2026-08-16T10:00:00+08:00");
  const window = periodWindow("week", sunday);
  assert.equal(shanghaiDateKey(window.startAt), "2026-08-10");
  assert.equal(window.dateKey, "2026-08-10");
  assert.equal(snapshotDateKey("week", sunday), "2026-08-10");
  assert.equal(snapshotDateKey("today", sunday), "2026-08-16");
});
