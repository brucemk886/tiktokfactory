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

test("stores and updates the book platform, free chapters and promotion code", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-content-"));
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => [] } });
  const novel = service.createNovel({
    title: "A novel title",
    platform: "GoodNovel",
    promotionCode: "PROMO-001",
    sourceContent: "This is the complete free chapter content used by the local novel library."
  });
  assert.equal(novel.platform, "GoodNovel");
  assert.equal(novel.promotionCode, "PROMO-001");

  service.updateNovel(novel.id, { platform: "MasterNovel", promotionCode: "PROMO-002" });
  const overview = service.getOverview();
  assert.equal(overview.novels[0].platform, "MasterNovel");
  assert.equal(overview.novels[0].promotionCode, "PROMO-002");
  assert.match(overview.novels[0].sourceContent, /free chapter content/);
});

test("rejects unsupported novel platforms", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-content-"));
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => [] } });
  assert.throws(() => service.createNovel({
    title: "Unsupported platform",
    platform: "Dreame",
    sourceContent: "This free chapter is long enough to validate the selected platform."
  }), /GoodNovel.*MotoNovel.*MasterNovel/);
});
