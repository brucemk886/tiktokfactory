import assert from "node:assert/strict";
import test from "node:test";
import { attachPublishOutcome, computeGroupReport, connectionIdsFromArchiveRows, mergePublishStats, paginateItems, periodWindow, resolveReportWindow, shanghaiDateKey, snapshotDateKey, tiktokWatchUrl } from "./official-group-report.js";
import { readFile } from "node:fs/promises";

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
  const next = attachPublishOutcome(report, { total: 106, success: 92, failed: 14, riskAccounts: 7 });
  assert.equal(next.summary.published, 1);
  assert.equal(next.summary.publishTotal, 106);
  assert.equal(next.summary.publishSuccess, 92);
  assert.equal(next.summary.publishFailed, 14);
  assert.equal(next.summary.riskAccountCount, 7);
  assert.deepEqual(connectionIdsFromArchiveRows([
    { account_key: "tiktok:c6a46b42-c30b-4f4e-b832-50082715f5f2" },
    { schema: "tiktok:c6a46b42-c30b-4f4e-b832-50082715f5f2" },
    { accountKey: "zoedecker03" },
  ]), ["c6a46b42-c30b-4f4e-b832-50082715f5f2"]);
  assert.deepEqual(mergePublishStats([
    { success: 90, failed: 10, riskAccounts: 6 },
    { success: 2, failed: 4, riskAccounts: 1 },
  ]), { total: 106, success: 92, failed: 14, riskAccounts: 7, pendingIngest: 0 });
});

test("pages low and high videos ten at a time and builds TikTok jump links", () => {
  const rows = Array.from({ length: 23 }, (_, index) => ({ id: `v${index + 1}`, views: index }));
  const first = paginateItems(rows, 1);
  const third = paginateItems(rows, 3);
  assert.equal(first.pageSize, 10);
  assert.equal(first.items.length, 10);
  assert.equal(first.items[0].id, "v1");
  assert.equal(third.page, 3);
  assert.equal(third.items.length, 3);
  assert.equal(third.pageCount, 3);
  assert.equal(tiktokWatchUrl({
    id: "7550123456789012345",
    username: "zoedecker03",
  }), "https://www.tiktok.com/@zoedecker03/video/7550123456789012345");
});

test("ops report puts publish total first and high videos above low videos", async () => {
  const root = new URL(".", import.meta.url);
  const [page, html] = await Promise.all([
    readFile(new URL("../public/official-group-report.js", root), "utf8"),
    readFile(new URL("../public/official-group-report.html", root), "utf8"),
  ]);
  assert.match(page, /PAGE_SIZE = 10/);
  assert.match(page, /ops-video-pager/);
  assert.match(page, /打开/);
  assert.match(page, /state.module === "novel-promotion" \? "数据概览"/);
  assert.ok(page.indexOf('["发布总数"') < page.indexOf('["发布视频"'));
  assert.ok(page.indexOf("highSection") < page.indexOf("lowSection"));
  assert.ok(html.indexOf('id="highSection"') < html.indexOf('id="lowSection"'));
  assert.match(html, /data-period="today"/);
  assert.match(html, /data-period="yesterday"/);
  assert.match(html, /data-period="7d"/);
  assert.match(html, /data-period="30d"/);
  assert.doesNotMatch(html, /id="fromDate"/);
  assert.match(page, /近7天/);
  assert.match(page, /最近30天/);
});

test("week window starts on Monday in Shanghai", () => {
  const sunday = Date.parse("2026-08-16T10:00:00+08:00");
  const window = periodWindow("week", sunday);
  assert.equal(shanghaiDateKey(window.startAt), "2026-08-10");
  assert.equal(window.dateKey, "2026-08-10");
  assert.equal(snapshotDateKey("week", sunday), "2026-08-10");
  assert.equal(snapshotDateKey("today", sunday), "2026-08-16");
});

test("yesterday, 7d and 30d windows use Shanghai calendar days", () => {
  const now = Date.parse("2026-08-30T19:00:00+08:00");
  const yesterday = periodWindow("yesterday", now);
  const week = periodWindow("7d", now);
  const month = periodWindow("30d", now);
  assert.equal(yesterday.fromKey, "2026-08-29");
  assert.equal(yesterday.toKey, "2026-08-29");
  assert.equal(week.fromKey, "2026-08-24");
  assert.equal(week.toKey, "2026-08-30");
  assert.equal(month.fromKey, "2026-08-01");
  assert.equal(month.toKey, "2026-08-30");
  const report = computeGroupReport({
    group: { id: "g1", name: "A组" },
    project: { id: "p1", name: "小说推文" },
    period: "7d",
    now,
    videos: [
      { id: "edge", username: "a", title: "第1天", views: 100, createdAt: Date.parse("2026-08-24T00:10:00+08:00") },
      { id: "today", username: "a", title: "今天", views: 200, createdAt: Date.parse("2026-08-30T18:00:00+08:00") },
      { id: "before", username: "a", title: "更早", views: 9000, createdAt: Date.parse("2026-08-23T23:50:00+08:00") },
    ],
  });
  assert.equal(report.summary.published, 2);
  assert.equal(report.period, "7d");
  assert.equal(resolveReportWindow({
    period: "today",
    now,
    fromKey: "2026-08-01",
    toKey: "2026-08-30",
  }).period, "30d");
});
