import assert from "node:assert/strict";
import test from "node:test";
import { createNovelEffectService } from "./novel-effect-service.js";

function overviewFor(videos = []) {
  return {
    summary: { novelCount: 1, scriptCount: 1, audioCount: 1, videoCount: videos.length },
    novels: [{
      id: "novel-1", title: "Story", scripts: [{
        id: "script-1", audio: { id: "audio-1", title: "Opening" }, videos,
        performance: { videoCount: videos.length, accountCount: videos.length ? 1 : 0, totalViews: videos.reduce((sum, item) => sum + Number(item.views || 0), 0) },
      }],
    }],
    unassignedScripts: [],
  };
}

test("keeps third-party effects separate from official API effects", async () => {
  let officialCalls = 0;
  const service = createNovelEffectService({
    novelContentLibrary: { getOverview: () => overviewFor([{ username: "third", views: 88 }]) },
    officialAnalyticsService: { getOperationSignals: async () => { officialCalls += 1; return { accounts: [] }; } },
  });
  const result = await service.getOverview({ source: "third_party" });
  assert.equal(officialCalls, 0);
  assert.equal(result.dataStatus.source, "third_party");
  assert.equal(result.summary.totalViews, 88);
});

test("maps official videos to local audio content through TikTok video id", async () => {
  let captured = [];
  const service = createNovelEffectService({
    novelContentLibrary: {
      getOverviewFromVideos(videos) { captured = videos; return overviewFor(videos); },
    },
    officialAnalyticsService: {
      getOperationSignals: async () => ({ status: "ready", connected: true, accounts: [{ username: "creator", videos: [{ id: "video-9", views: 123, comments: 4, createTime: 1_786_000_000 }] }] }),
    },
    readPublishRecords: () => [{ videoId: "video-9", username: "creator", audioLibraryId: "audio-1", id: "publish-1" }],
  });
  const result = await service.getOverview({ source: "official_api", days: 7 });
  assert.equal(captured[0].local.audioLibraryId, "audio-1");
  assert.equal(captured[0].local.publishRecordId, "publish-1");
  assert.equal(captured[0].publishedAt, 1_786_000_000_000);
  assert.equal(result.dataStatus.rawVideoCount, 1);
  assert.equal(result.dataStatus.mappedVideoCount, 1);
  assert.equal(result.summary.totalViews, 123);
  assert.equal(result.summary.comments, 4);
});

test("reuses supplied official signals when building the operation decision context", async () => {
  let officialCalls = 0;
  let captured = [];
  const suppliedSignals = {
    status: "ready",
    connected: true,
    accounts: [{ username: "creator", videos: [{ id: "video-10", views: 55 }] }],
  };
  const service = createNovelEffectService({
    novelContentLibrary: {
      getOverviewFromVideos(videos) { captured = videos; return overviewFor(videos); },
    },
    officialAnalyticsService: {
      getOperationSignals: async () => { officialCalls += 1; return { accounts: [] }; },
    },
    readPublishRecords: () => [{
      videoId: "video-10",
      username: "creator",
      novelId: "novel-1",
      scriptId: "script-1",
      audioLibraryId: "audio-1",
    }],
  });

  const result = await service.getDecisionContext({ signals: suppliedSignals });
  assert.equal(officialCalls, 0);
  assert.equal(captured[0].local.novelId, "novel-1");
  assert.equal(captured[0].local.scriptId, "script-1");
  assert.equal(result.videoMappings[0].videoId, "video-10");
  assert.equal(result.videoMappings[0].local.audioLibraryId, "audio-1");
});

test("rejects unknown novel effect sources", async () => {
  const service = createNovelEffectService({ novelContentLibrary: { getOverview: () => overviewFor() } });
  await assert.rejects(() => service.getOverview({ source: "mixed" }), /Unsupported data source/);
});

test("slims novel effects payload and drops zero-view books", async () => {
  const { slimEffectsPage } = await import("./novel-effect-core.js");
  const page = slimEffectsPage({
    summary: { totalViews: 12 },
    novels: [
      { id: "hot", title: "Hot", sourceContent: "very long body", performance: { totalViews: 12 }, scripts: [{ id: "s1", text: "A".repeat(400), performance: { totalViews: 12 }, videos: [{ caption: "B".repeat(300), views: 12 }] }] },
      { id: "cold", title: "Cold", sourceContent: "unused", performance: { totalViews: 0 }, scripts: [] },
    ],
    unassignedScripts: [{ id: "u1", performance: { totalViews: 0 } }],
  });
  assert.equal(page.novels.length, 1);
  assert.equal(page.novels[0].sourceContent, undefined);
  assert.ok(page.novels[0].scripts[0].openingText.length <= 180);
  assert.ok(page.novels[0].scripts[0].videos[0].caption.length <= 160);
  assert.equal(page.unassignedScripts.length, 0);
});
