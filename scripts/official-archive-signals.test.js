import assert from "node:assert/strict";
import test from "node:test";
import { buildArchiveOperationSignals, mapArchiveVideoRow } from "./official-archive-signals.js";

test("builds operation signals from archive rows without calling TikTok", () => {
  const createdAt = Date.now() - 2 * 86_400_000;
  const signals = buildArchiveOperationSignals({
    accountRows: [{
      account_key: "tiktok:one",
      label: "@one",
      profile_json: JSON.stringify({ username: "one", displayName: "One" }),
    }],
    videosForAccount: () => [mapArchiveVideoRow({
      video_id: "111",
      account_key: "tiktok:one",
      create_time: Math.floor(createdAt / 1000),
      title: "opening",
      views: 88,
      comments: 3,
      video_json: JSON.stringify({ id: "111", views: 88, averageTimeWatched: 4 }),
    })],
    days: 7,
    archiveDate: "2026-08-18",
    archiveAt: createdAt,
    now: () => Date.now(),
  });
  assert.equal(signals.status, "ready");
  assert.equal(signals.archiveDate, "2026-08-18");
  assert.equal(signals.accounts[0].username, "one");
  assert.equal(signals.accounts[0].videos[0].views, 88);
});
