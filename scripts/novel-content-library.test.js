import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNovelContentLibraryService } from "./novel-content-library.js";

test("groups generated and rewritten scripts under one novel with matched video performance", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-content-"));
  const audioItems = [{
    id: "audio-original", title: "Opening A", fileName: "opening-a.mp3", script: "A complete original narration that is long enough for this test.",
    source: { marketingId: "marketing-1", rank: 1 }, createdAt: "2026-08-01T00:00:00.000Z"
  }, {
    id: "audio-rewrite", title: "Opening B", fileName: "opening-b.mp3", script: "A rewritten narration with a stronger and clearer opening for testing.",
    source: { type: "ai-operation-rewrite", sourceAudioId: "audio-original", sourceVideoId: "video-1" }, createdAt: "2026-08-02T00:00:00.000Z"
  }];
  const service = createNovelContentLibraryService({
    workDir,
    audioLibrary: { list: () => audioItems },
    analyticsService: { getMatchedVideos: () => [{ id: "video-1", username: "account-a", views: 1200, comments: 8, createTime: 10, local: { audioName: "opening-a.mp3", matchConfidence: "high" } }] },
    readPublishRecords: () => []
  });
  const imported = service.importMarketingResult({
    id: "marketing-1", generatedAt: "2026-08-01T00:00:00.000Z",
    marketing: { packageTitle: "Story", selected: [{ rank: 1, sourceHookId: 2, angle: "betrayal", title: "Opening A", script: audioItems[0].script }] }
  }, { title: "Story", category: "Drama", sourceText: "This is the canonical source novel content used to generate multiple script variants." });
  const overview = service.getOverview();
  assert.equal(overview.novels.length, 1);
  assert.equal(overview.novels[0].id, imported.novelId);
  assert.equal(overview.novels[0].scripts.length, 2);
  assert.equal(overview.novels[0].scripts.find((item) => item.audioId === "audio-original").performance.totalViews, 1200);
  assert.equal(overview.novels[0].scripts.find((item) => item.audioId === "audio-rewrite").parentScriptId, imported.scriptIds[0]);
});

test("keeps orphan audio scripts unassigned until the operator selects a novel", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-content-"));
  const audioItems = [{ id: "orphan-audio", title: "Legacy", fileName: "legacy.mp3", script: "A legacy narration that has not yet been assigned to a novel.", source: {} }];
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => audioItems } });
  const novel = service.createNovel({ title: "Assigned story", platform: "MotoNovel", category: "Drama", sourceContent: "This is the canonical source content for the assigned story." });
  let overview = service.getOverview();
  assert.equal(overview.unassignedScripts.length, 1);
  service.assignScript(overview.unassignedScripts[0].id, { novelId: novel.id, versionLabel: "原始文案" });
  overview = service.getOverview();
  assert.equal(overview.unassignedScripts.length, 0);
  assert.equal(overview.novels[0].scripts[0].audioId, "orphan-audio");
});

test("stores and updates the book platform, free chapters, promotion code and promotion copy", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-content-"));
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => [] } });
  const novel = service.createNovel({
    title: "A novel title",
    platform: "GoodNovel",
    promotionCode: "PROMO-001",
    promotionCopy: "A launch caption for the first campaign.",
    sourceContent: "This is the complete free chapter content used by the local novel library."
  });
  assert.equal(novel.platform, "GoodNovel");
  assert.equal(novel.promotionCode, "PROMO-001");
  assert.equal(novel.promotionCopy, "A launch caption for the first campaign.");

  service.updateNovel(novel.id, { platform: "NovelMaster", promotionCode: "PROMO-002", promotionCopy: "Updated campaign caption." });
  const overview = service.getOverview();
  assert.equal(overview.novels[0].platform, "NovelMaster");
  assert.equal(overview.novels[0].promotionCode, "PROMO-002");
  assert.equal(overview.novels[0].promotionCopy, "Updated campaign caption.");
  assert.match(overview.novels[0].sourceContent, /free chapter content/);
});

test("rejects unsupported novel platforms", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-content-"));
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => [] } });
  assert.throws(() => service.createNovel({
    title: "Unsupported platform",
    platform: "Dreame",
    sourceContent: "This free chapter is long enough to validate the selected platform."
  }), /GoodNovel.*MotoNovel.*NovelMaster/);
});

test("stores a creation-time featured mark and ranks data hits separately per platform", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-content-"));
  const audioItems = [{
    id: "audio-goodnovel-hit", title: "Hit A", fileName: "hit-a.mp3", script: "A GoodNovel narration that is long enough for ranking.",
    source: {}, createdAt: "2026-08-01T00:00:00.000Z"
  }, {
    id: "audio-motonovel-hit", title: "Hit B", fileName: "hit-b.mp3", script: "A MotoNovel narration that is long enough for ranking.",
    source: {}, createdAt: "2026-08-01T00:00:00.000Z"
  }];
  const service = createNovelContentLibraryService({
    workDir,
    audioLibrary: { list: () => audioItems },
    analyticsService: {
      getMatchedVideos: () => [{
        id: "video-goodnovel", username: "account-a", views: 2400, comments: 12, createTime: 10,
        local: { audioName: "hit-a.mp3", matchConfidence: "high" }
      }, {
        id: "video-motonovel", username: "account-b", views: 1800, comments: 6, createTime: 11,
        local: { audioName: "hit-b.mp3", matchConfidence: "high" }
      }]
    },
    readPublishRecords: () => []
  });
  const featured = service.createNovel({
    title: "Featured GoodNovel",
    platform: "GoodNovel",
    featured: true,
    sourceContent: "This featured GoodNovel free chapter is long enough for the catalog."
  });
  const goodHit = service.createNovel({
    title: "Data hit GoodNovel",
    platform: "GoodNovel",
    sourceContent: "This GoodNovel free chapter is long enough to receive a data hit mark."
  });
  const motoHit = service.createNovel({
    title: "Data hit MotoNovel",
    platform: "MotoNovel",
    sourceContent: "This MotoNovel free chapter is long enough to receive a data hit mark."
  });
  service.assignScript("script-audio-goodnovel-hit", { novelId: goodHit.id });
  service.assignScript("script-audio-motonovel-hit", { novelId: motoHit.id });

  const overview = service.getOverview();
  const byId = Object.fromEntries(overview.novels.map((item) => [item.id, item]));
  assert.equal(byId[featured.id].featured, true);
  assert.equal(byId[featured.id].hit, false);
  assert.equal(byId[goodHit.id].featured, false);
  assert.equal(byId[goodHit.id].hit, true);
  assert.equal(byId[goodHit.id].hitRank, 1);
  assert.equal(byId[goodHit.id].hitLabel, "平台播放 Top 1");
  assert.equal(byId[motoHit.id].hit, true);
  assert.equal(byId[motoHit.id].hitRank, 1);
  assert.equal(overview.catalog.totals.featuredCount, 1);
  assert.equal(overview.catalog.totals.hitCount, 2);
  assert.equal(overview.catalog.platforms.find((item) => item.platform === "GoodNovel").featuredCount, 1);
  assert.equal(overview.catalog.platforms.find((item) => item.platform === "GoodNovel").hitCount, 1);
  assert.equal(overview.catalog.platforms.find((item) => item.platform === "MotoNovel").hitCount, 1);

  service.updateNovel(featured.id, { featured: false });
  assert.equal(service.getOverview().novels.find((item) => item.id === featured.id).featured, false);
});

test("saves a manual rewrite as a derived script under the selected novel", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-content-"));
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => [] } });
  const novel = service.createNovel({
    title: "Rewrite target",
    platform: "NovelMaster",
    sourceContent: "This free chapter is long enough to become the source for a manual rewrite."
  });
  const first = service.createScript(novel.id, {
    title: "Opening A",
    versionLabel: "原开头",
    text: "A complete original narration that is long enough for this rewrite test."
  });
  const rewritten = service.createScript(novel.id, {
    parentScriptId: first.id,
    title: "Opening A rewrite",
    versionLabel: "人工改写",
    text: "A rewritten narration that starts with the conflict and keeps the same ending facts."
  });
  const loaded = service.getNovel(novel.id);
  assert.equal(rewritten.parentScriptId, first.id);
  assert.equal(rewritten.sourceType, "manual-rewrite");
  assert.equal(loaded.scripts.length, 2);
  assert.equal(loaded.scripts.find((item) => item.id === rewritten.id).versionLabel, "人工改写");
  assert.throws(() => service.createScript(novel.id, { parentScriptId: "missing", text: "A rewritten narration that is long enough for validation." }), /原文案不属于这本小说/);
});

test("migrates legacy MasterNovel records to NovelMaster when reading the catalog", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-content-"));
  fs.writeFileSync(path.join(workDir, "novel-content-library.json"), JSON.stringify({
    version: 1,
    novels: [{
      id: "legacy-master-novel",
      title: "Legacy title",
      platform: "MasterNovel",
      promotionCode: "LEGACY",
      sourceContent: "This legacy free chapter is long enough to remain in the catalog."
    }],
    scripts: []
  }));
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => [] } });
  assert.equal(service.getOverview().novels[0].platform, "NovelMaster");
});
