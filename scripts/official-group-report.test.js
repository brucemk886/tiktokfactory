import assert from "node:assert/strict";
import test from "node:test";
import { computeGroupReport, periodWindow, shanghaiDateKey } from "./official-group-report.js";

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
  assert.equal(report.anomalyAccounts[0].username, "a");
  assert.equal(report.buckets.highView[0].id, "v2");
});

test("week window starts on Monday in Shanghai", () => {
  const sunday = Date.parse("2026-08-16T10:00:00+08:00");
  const window = periodWindow("week", sunday);
  assert.equal(shanghaiDateKey(window.startAt), "2026-08-10");
});
