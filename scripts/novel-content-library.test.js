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

test("saves which opening audios are enabled for mix", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-mix-audio-"));
  const audioItems = [{
    id: "audio-keep", title: "Keep", fileName: "keep.mp3", script: "A complete original narration that is long enough for this test."
  }, {
    id: "audio-skip", title: "Skip", fileName: "skip.mp3", script: "A rewritten narration with a stronger and clearer opening for testing."
  }];
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => audioItems } });
  const novel = service.createNovel({
    title: "Mix story",
    platform: "GoodNovel",
    sourceContent: "This is the complete free chapter content used by the local novel library."
  });
  const keep = service.createScript(novel.id, { text: audioItems[0].script, versionLabel: "留下" });
  const skip = service.createScript(novel.id, { text: audioItems[1].script, versionLabel: "关掉" });
  service.attachScriptAudio(keep.id, "audio-keep");
  service.attachScriptAudio(skip.id, "audio-skip");
  const updated = service.setNovelMixAudios(novel.id, [keep.id]);
  assert.equal(updated.scripts.find((item) => item.id === keep.id).mixEnabled, true);
  assert.equal(updated.scripts.find((item) => item.id === skip.id).mixEnabled, false);
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
  assert.equal(
    overview.catalog.totals.audioCount,
    overview.novels.reduce((sum, item) => sum + Number(item.audioCount || 0), 0)
  );
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
  assert.equal(rewritten.parentScriptId, first.id);
  assert.equal(rewritten.sourceType, "manual-rewrite");
  assert.equal(first.openingTitle, "A complete original narration that is long enough for this rewrite test.");
  const titled = service.createScript(novel.id, {
    parentScriptId: first.id,
    title: "Opening A hook",
    versionLabel: "钩子标题",
    openingTitle: "She married my uncle",
    text: "She married my uncle after I found the letter he hid in the church pew."
  });
  assert.equal(titled.openingTitle, "She married my uncle");
  const styled = service.createScript(novel.id, {
    parentScriptId: first.id,
    title: "Opening A style",
    versionLabel: "冲突先行",
    sourceType: "ai-style-rewrite",
    text: "A styled narration that starts with the conflict and keeps the same characters and ending."
  });
  const loaded = service.getNovel(novel.id);
  assert.equal(styled.sourceType, "ai-style-rewrite");
  assert.equal(loaded.scripts.length, 4);
  assert.equal(loaded.scripts.find((item) => item.id === rewritten.id).versionLabel, "人工改写");
  assert.throws(() => service.createScript(novel.id, { parentScriptId: "missing", text: "A rewritten narration that is long enough for validation." }), /原文案不属于这本小说/);
});

test("near-duplicate versions and CTAs for the wrong code are not saved", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-content-dedupe-"));
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => [] } });
  const novel = service.createNovel({
    title: "Dedupe target",
    platform: "GoodNovel",
    promotionCode: "G123",
    sourceContent: "This free chapter is long enough to become the source for a rewrite."
  });
  const text = "My sister stole my wedding date and my parents took her side. I found out from a group chat, not from her. Nobody in my family understood why I was upset. Search G123 on the GoodNovel app to read the full story.";
  service.createScript(novel.id, { title: "v1", text });
  assert.throws(
    () => service.createScript(novel.id, { title: "v2", text: text.replace("upset", "hurt") }),
    (error) => error.statusCode === 409 && error.code === "DUPLICATE_SCRIPT" && /几乎一样/.test(error.message)
  );
  // Explicit override still works.
  const forced = service.createScript(novel.id, { title: "v2 forced", text: text.replace("upset", "hurt"), allowDuplicate: true });
  assert.ok(forced.id);
  assert.throws(
    () => service.createScript(novel.id, { title: "wrong code", text: "A totally new opening about a stolen inheritance and a locked room. Search 999999 on the GoodNovel app to read the full story." }),
    (error) => error.statusCode === 400 && error.code === "CTA_MISMATCH" && /999999/.test(error.message)
  );
  assert.throws(
    () => service.createScript(novel.id, { title: "wrong app", text: "A totally new opening about a stolen inheritance and a locked room. Search G123 on the Novel Master app to read the full story." }),
    (error) => error.code === "CTA_MISMATCH"
  );
  const fine = service.createScript(novel.id, { title: "ok", text: "A totally new opening about a stolen inheritance and a locked room. Search G123 on the GoodNovel app to read the full story." });
  assert.ok(fine.id);
  assert.equal(service.getNovel(novel.id).scripts.length, 3);
});

test("updates a saved script text without creating another version", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-content-edit-"));
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => [] } });
  const novel = service.createNovel({
    title: "Edit target",
    platform: "NovelMaster",
    sourceContent: "This free chapter is long enough to become the source for a manual rewrite."
  });
  const script = service.createScript(novel.id, {
    title: "Opening A",
    versionLabel: "人工改写",
    kept: true,
    text: "A complete original narration that is long enough for this rewrite test."
  });
  const updated = service.updateScript(novel.id, script.id, {
    text: "The comments told him to take the other girl, and he did it on live after dinner.",
    openingTitle: "He chose her on live"
  });
  assert.equal(updated.id, script.id);
  assert.match(updated.text, /comments told him/);
  assert.equal(updated.openingTitle, "He chose her on live");
  assert.equal(updated.kept, true);
  assert.equal(service.getNovel(novel.id).scripts.length, 1);
  assert.throws(() => service.updateScript(novel.id, script.id, { text: "too short" }), /至少需要 20/);
});

test("exposes rewrite audio files and performance on the novel for the audio board", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-audio-board-"));
  const audioItems = [{
    id: "audio-opening",
    title: "Opening A",
    fileName: "opening-a.mp3",
    script: "A complete original narration that is long enough for this audio board.",
    duration: 42,
    size: 2048,
    scriptChars: 80,
    targetAudioPath: "D:/seed-audio/opening-a.mp3",
    source: { type: "manual-rewrite" },
    createdAt: "2026-08-14T00:00:00.000Z"
  }];
  const service = createNovelContentLibraryService({
    workDir,
    audioLibrary: { list: () => audioItems }
  });
  const novel = service.createNovel({
    title: "Audio board story",
    platform: "GoodNovel",
    sourceContent: "This free chapter is long enough to generate rewrite audio for the board."
  });
  const script = service.createScript(novel.id, {
    title: "Opening A",
    versionLabel: "开头版本 1",
    text: audioItems[0].script
  });
  service.attachScriptAudio(script.id, "audio-opening");
  const loaded = service.getNovel(novel.id);
  const row = loaded.scripts.find((item) => item.id === script.id);
  assert.equal(row.audio.id, "audio-opening");
  assert.equal(row.audio.duration, 42);
  assert.equal(row.audio.size, 2048);
  assert.equal(row.audio.targetAudioPath, "D:/seed-audio/opening-a.mp3");
  assert.equal(row.audio.sourceType, "manual-rewrite");
});

test("prunes unsaved drafts and keeps voiced or explicitly saved scripts", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-prune-"));
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => [] } });
  const novel = service.createNovel({
    title: "Prune drafts book",
    platform: "NovelMaster",
    sourceContent: "This free chapter is long enough for the prune drafts catalog test."
  });
  const keep = service.createScript(novel.id, {
    title: "Keep audio",
    versionLabel: "已配音",
    text: "A complete narration that should stay because it will be attached to audio."
  });
  const pending = service.createScript(novel.id, {
    title: "Keep pending",
    versionLabel: "待配音",
    kept: true,
    text: "A complete narration that should stay because the operator saved it for later audio."
  });
  const drop = service.createScript(novel.id, {
    title: "Drop draft",
    versionLabel: "未配音",
    text: "A complete narration that should be removed because it never received audio."
  });
  service.attachScriptAudio(keep.id, "audio-keep");
  const result = service.pruneDraftScripts(novel.id);
  assert.equal(result.removedCount, 1);
  assert.deepEqual(result.novel.scripts.map((item) => item.id).sort(), [keep.id, pending.id].sort());
  assert.ok(!result.novel.scripts.some((item) => item.id === drop.id));
});

test("deletes a voiced script without removing other openings", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-script-delete-"));
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => [] } });
  const novel = service.createNovel({
    title: "Delete voiced book",
    platform: "GoodNovel",
    sourceContent: "This free chapter is long enough for the voiced script delete test."
  });
  const keep = service.createScript(novel.id, {
    title: "Keep this opening",
    versionLabel: "保留",
    text: "A complete narration that should stay after the other voiced opening is deleted."
  });
  const drop = service.createScript(novel.id, {
    title: "Drop this opening",
    versionLabel: "删除",
    text: "A complete narration that should be removed even though it already has audio."
  });
  service.attachScriptAudio(keep.id, "audio-keep");
  service.attachScriptAudio(drop.id, "audio-drop");
  const result = service.deleteScript(novel.id, drop.id);
  assert.equal(result.ok, true);
  assert.equal(result.removed, true);
  assert.deepEqual(result.novel.scripts.map((item) => item.id), [keep.id]);
  assert.throws(() => service.deleteScript(novel.id, drop.id), /没有找到这条音频/);
});

test("deletes a novel and its rewrite scripts without removing other books", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-delete-"));
  const service = createNovelContentLibraryService({ workDir, audioLibrary: { list: () => [] } });
  const keep = service.createNovel({
    title: "Keep this book",
    platform: "GoodNovel",
    sourceContent: "This free chapter belongs to the book that should stay in the catalog."
  });
  const remove = service.createNovel({
    title: "Remove this book",
    platform: "NovelMaster",
    sourceContent: "This free chapter belongs to the book that should be deleted from the catalog."
  });
  service.createScript(remove.id, {
    title: "Opening A",
    versionLabel: "原开头",
    text: "A complete original narration that is long enough for this delete test."
  });
  const result = service.deleteNovel(remove.id);
  assert.equal(result.ok, true);
  assert.equal(result.id, remove.id);
  assert.equal(result.removedScriptCount, 1);
  const overview = service.getOverview();
  assert.equal(overview.novels.length, 1);
  assert.equal(overview.novels[0].id, keep.id);
  assert.equal(overview.novels[0].scripts.length, 0);
  assert.throws(() => service.getNovel(remove.id), /没有找到该小说/);
  assert.throws(() => service.deleteNovel("missing-novel"), /没有找到该小说/);
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
