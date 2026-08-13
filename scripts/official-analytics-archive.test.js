import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOfficialAnalyticsArchive } from "./official-analytics-archive.js";

test("archives official history in indexed SQLite tables", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-archive-"));
  let timestamp = Date.parse("2026-08-12T08:30:00+08:00");
  let views = 100;
  const service = {
    listArchivePage: async () => ({
      accounts: [{ schema: "tiktok:one", label: "@one", profile: { username: "one", followers: 12 }, videos: [{ id: "12345", views, likes: 8, reach: 70 }], archiveAvailable: true }],
      hasMore: false,
      nextCursor: "",
    }),
  };
  const archive = createOfficialAnalyticsArchive({ workDir, service, now: () => timestamp, requestIntervalMs: 0 });
  context.after(() => { archive.close(); fs.rmSync(workDir, { recursive: true, force: true }); });
  await archive.run({ ignoreDailyGuard: true });
  timestamp = Date.parse("2026-08-13T08:30:00+08:00");
  views = 220;
  await archive.run({ ignoreDailyGuard: true });
  const databasePath = path.join(workDir, "official-tiktok-history", "official-history.sqlite");
  assert.ok(fs.existsSync(databasePath));
  assert.equal(fs.existsSync(path.join(workDir, "official-tiktok-history", "2026-08-12.json")), false);
  const dashboard = archive.getDashboard({ days: 30, account: "tiktok:one", video: "12345" });
  assert.equal(dashboard.databasePath, databasePath);
  assert.deepEqual(dashboard.videoHistory.map((item) => item.views), [100, 220]);
  assert.deepEqual(dashboard.accountHistory.map((item) => item.followers), [12, 12]);
  assert.deepEqual(dashboard.accountHistory.map((item) => item.views), [100, 220]);
  assert.equal(dashboard.overview.views, 220);

  const independentRange = archive.getDashboard({ days: 1, accountDays: 30, account: "tiktok:one", video: "12345" });
  assert.deepEqual(independentRange.videoHistory.map((item) => item.views), [220]);
  assert.deepEqual(independentRange.accountHistory.map((item) => item.views), [100, 220]);
});

test("imports legacy daily JSON once and keeps the source file", (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-legacy-"));
  const archiveDir = path.join(workDir, "official-tiktok-history");
  fs.mkdirSync(archiveDir, { recursive: true });
  const legacyPath = path.join(archiveDir, "2026-08-11.json");
  fs.writeFileSync(legacyPath, JSON.stringify({
    version: 1, dateKey: "2026-08-11", startedAt: 1, completedAt: 2, accountCount: 1, videoCount: 1, errors: [],
    accounts: [{ schema: "legacy", label: "Legacy", syncedAt: 2, profile: { followers: 9 }, videos: [{ id: "old-video", views: 88 }] }],
  }));
  const service = { listArchivePage: async () => ({ accounts: [], hasMore: false, nextCursor: "" }) };
  const archive = createOfficialAnalyticsArchive({ workDir, service });
  context.after(() => { archive.close(); fs.rmSync(workDir, { recursive: true, force: true }); });
  const dashboard = archive.getDashboard({ days: "all", account: "legacy", video: "old-video" });
  assert.equal(dashboard.overview.views, 88);
  assert.equal(dashboard.videoHistory.length, 1);
  assert.equal(fs.existsSync(legacyPath), true);
});
