import assert from "node:assert/strict";
import test from "node:test";
import { assembleOfficialNovelEffects } from "./novel-effect-core.js";
import { archiveAccountKeysForProject, uniqueProjectAccountCount } from "./official-account-group-store.js";
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

test("yesterday period only keeps videos from the previous Shanghai day", async () => {
  let captured = [];
  const service = createNovelEffectService({
    novelContentLibrary: {
      getOverviewFromVideos(videos) { captured = videos; return overviewFor(videos); },
    },
    officialAnalyticsService: {
      getOperationSignals: async () => ({
        status: "ready",
        connected: true,
        accounts: [{
          username: "creator",
          videos: [
            { id: "today", views: 90, createdAt: Date.parse("2026-08-30T10:00:00+08:00") },
            { id: "yesterday", views: 40, createdAt: Date.parse("2026-08-29T22:00:00+08:00") },
            { id: "older", views: 10, createdAt: Date.parse("2026-08-28T22:00:00+08:00") },
          ],
        }],
      }),
    },
  });
  const now = Date.now;
  Date.now = () => Date.parse("2026-08-30T19:40:00+08:00");
  try {
    const result = await service.getOverview({ source: "official_api", period: "yesterday" });
    assert.deepEqual(captured.map((video) => video.id || video.videoId), ["yesterday"]);
    assert.equal(result.dataStatus.period, "yesterday");
    assert.equal(result.summary.totalViews, 40);
  } finally {
    Date.now = now;
  }
});

test("rejects unknown novel effect sources", async () => {
  const service = createNovelEffectService({ novelContentLibrary: { getOverview: () => overviewFor() } });
  await assert.rejects(() => service.getOverview({ source: "mixed" }), /Unsupported data source/);
});

test("overview summary counts all novel-project videos not only mapped openings", () => {
  const page = assembleOfficialNovelEffects({
    store: {
      novels: [{ id: "novel-1", title: "Story" }],
      scripts: [{ id: "script-1", novelId: "novel-1", audioId: "audio-1" }],
    },
    audioItems: [{ id: "audio-1", title: "Opening" }],
    signals: {
      status: "ready",
      connected: true,
      accounts: [
        { username: "mapped", videos: [{ id: "v1", views: 100, comments: 2, createTime: 1_786_000_000 }] },
        { username: "unmapped", videos: [{ id: "v2", views: 40, comments: 1, createTime: 1_786_000_000 }] },
      ],
    },
    records: [{ videoId: "v1", username: "mapped", audioLibraryId: "audio-1" }],
    projectAccountCount: 3,
  });
  assert.equal(page.summary.totalViews, 140);
  assert.equal(page.summary.videoCount, 2);
  assert.equal(page.summary.testedAccountCount, 3);
  assert.equal(page.dataStatus.mappedVideoCount, 1);
  assert.equal(page.novels[0].performance.totalViews, 100);
});

test("lists every assigned novel-project account even if archive is missing one", () => {
  const store = {
    projects: [{ id: "proj-novel", name: "小说推文", moduleKey: "novel-promotion" }],
    groups: [{ id: "g-novel", name: "A组", projectId: "proj-novel" }],
    assignments: { "connection-1": "g-novel", "connection-2": "g-novel" },
  };
  assert.equal(uniqueProjectAccountCount(store, "proj-novel"), 2);
  assert.deepEqual(archiveAccountKeysForProject(store, [
    { account_key: "tiktok:connection-1", label: "@one", username: "one" },
  ], "proj-novel").sort(), ["tiktok:connection-1", "tiktok:connection-2"]);
});

test("slims novel effects payload and keeps books that have videos even at zero views", async () => {
  const { slimEffectsPage } = await import("./novel-effect-core.js");
  const page = slimEffectsPage({
    summary: { totalViews: 12 },
    novels: [
      { id: "hot", title: "Hot", sourceContent: "very long body", performance: { totalViews: 12 }, scripts: [{ id: "s1", text: "A".repeat(400), performance: { totalViews: 12 }, videos: [{ caption: "B".repeat(300), views: 12 }] }] },
      { id: "fresh", title: "Fresh", performance: { totalViews: 0, videoCount: 2 }, scripts: [] },
      { id: "cold", title: "Cold", sourceContent: "unused", performance: { totalViews: 0 }, scripts: [] },
    ],
    unassignedScripts: [{ id: "u1", performance: { totalViews: 0 } }],
  });
  assert.equal(page.novels.length, 2);
  assert.equal(page.novels[0].sourceContent, undefined);
  assert.equal(page.novels[1].id, "fresh");
  assert.ok(page.novels[0].scripts[0].openingText.length <= 180);
  assert.ok(page.novels[0].scripts[0].videos[0].caption.length <= 160);
  assert.equal(page.unassignedScripts.length, 0);
});
