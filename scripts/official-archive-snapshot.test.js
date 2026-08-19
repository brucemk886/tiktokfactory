import assert from "node:assert/strict";
import test from "node:test";
import {
  accountVideoObjectKey,
  buildAccountRow,
  packAccountVideos,
  summarizeAccountVideos,
  unpackAccountVideos,
} from "./official-archive-snapshot.js";

test("packs one account's videos for R2 and keeps D1 metrics separate", () => {
  const row = buildAccountRow({
    schema: "tiktok:one",
    snapshotDate: "2026-08-19",
    latestSyncAt: 1_787_000_000_000,
    label: "@one",
    profile: { username: "one" },
    videos: [
      { id: "old", createTime: 10, views: 1, likes: 2, comments: 3, shares: 4, reach: 5 },
      { id: "new", createTime: 20, views: 88, likes: 8, comments: 1, shares: 0, reach: 90 },
    ],
  }, 1_787_000_100_000);
  assert.equal(row.account_key, "tiktok:one");
  assert.equal(row.video_count, 2);
  assert.equal(row.views, 89);
  assert.equal(accountVideoObjectKey(row.account_key), "official-archive/videos/tiktok%3Aone.json");
  const pack = packAccountVideos(row.account_key, row.videos, row);
  assert.equal(unpackAccountVideos(pack, 1)[0].id, "new");
  assert.deepEqual(summarizeAccountVideos(row.videos), {
    video_count: 2,
    views: 89,
    likes: 10,
    comments: 4,
    shares: 4,
    reach: 95,
  });
});
