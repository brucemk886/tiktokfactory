import assert from "node:assert/strict";
import test from "node:test";
import {
  applyArchiveViewsToSnapshot,
  buildPublishIndex,
  collectGroupPublishVideos,
  collectSnapshotVideoIds,
  dashboardFromSnapshot,
  normalizeOutputId,
  summarizePublishImpact
} from "./asset-usage-impact.js";

test("normalizes generated output and publish file names the same way", () => {
  assert.equal(normalizeOutputId("F:/out/Clip.One.mp4"), "clip.one");
  assert.equal(normalizeOutputId("Clip.One.MP4"), "clip.one");
});

test("matches mix output to official publish records and reuse tiers", () => {
  const publishIndex = buildPublishIndex([
    { provider: "official", fileName: "night-a.mp4", videoId: "7001", status: "published", accountUsername: "alice" },
    { provider: "official", fileName: "night-b.mp4", videoId: "7002", status: "published", accountUsername: "bob" },
    { provider: "geelark", fileName: "night-a.mp4", videoId: "ignore" }
  ]);
  const usage = {
    assets: {
      clip1: { usedCount: 12 },
      clip2: { usedCount: 3 }
    },
    generated: [
      { groupId: "asmr", outputId: "night-a", clips: [{ assetId: "clip1" }, { assetId: "clip1" }] },
      { groupId: "asmr", outputId: "night-b", clips: [{ assetId: "clip2" }] },
      { groupId: "asmr", outputId: "unpublished", clips: [{ assetId: "clip1" }] }
    ]
  };
  const { generatedCount, videos } = collectGroupPublishVideos(
    { id: "asmr" },
    usage,
    publishIndex,
    new Map([["7001", 240], ["7002", 80]])
  );
  assert.equal(generatedCount, 3);
  assert.equal(videos.length, 2);
  assert.equal(videos[0].avgReuse, 12);
  assert.equal(videos[0].views, 240);
  assert.equal(videos[0].viewKnown, true);
  const impact = summarizePublishImpact(videos, generatedCount);
  assert.equal(impact.publishedMatched, 2);
  assert.equal(impact.withVideoId, 2);
  assert.equal(impact.withViews, 2);
  assert.equal(impact.avgViews, 160);
  assert.equal(impact.reuseTiers.find((tier) => tier.key === "gte10").videos, 1);
  assert.equal(impact.reuseTiers.find((tier) => tier.key === "gte10").avgViews, 240);
  assert.equal(impact.reuseTiers.find((tier) => tier.key === "lt5").avgViews, 80);
});

test("factory archive views can be applied onto a snapshot", () => {
  const snapshot = {
    sampledAt: 10,
    groups: [{ id: "asmr", name: "ASMR", totalAssets: 1, generatedVideos: 1 }],
    dashboards: {
      asmr: {
        group: { id: "asmr", name: "ASMR", generatedVideos: 1 },
        summary: { totalAssets: 1 },
        folders: [],
        videos: [{ outputId: "night-a", videoId: "7001", views: 0, viewKnown: false, avgReuse: 8 }],
        highReuseAssets: [{ fileName: "ice.mp4", usedCount: 8, matchedVideoIds: ["7001"] }]
      }
    }
  };
  const enriched = applyArchiveViewsToSnapshot(snapshot, new Map([["7001", 321]]));
  assert.equal(enriched.dashboards.asmr.videos[0].views, 321);
  assert.equal(enriched.dashboards.asmr.impact.avgViews, 321);
  assert.equal(enriched.dashboards.asmr.highReuseAssets[0].impact.avgViews, 321);
  assert.deepEqual(collectSnapshotVideoIds(snapshot), ["7001"]);
  const dash = dashboardFromSnapshot(enriched, "asmr");
  assert.equal(dash.impact.withViews, 1);
  assert.equal(dash.highReuseAssets[0].matchedVideoIds, undefined);
});
