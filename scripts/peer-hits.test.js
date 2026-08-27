import assert from "node:assert/strict";
import test from "node:test";
import {
  attachAudioBoardImportStatus,
  attachFactoryNovel,
  attachPeerHitTimes,
  attachScaleRunMarks,
  planPeerHitPublishedAtWrites,
  collectImportItems,
  filterPeerHits,
  filterPeerHitsByPlatform,
  filterPeerHitsByTime,
  importedClipFingerprintsByNovel,
  importedPeerHitIdSet,
  importedSourceTokensByNovel,
  mergePeerHit,
  planPeerHitNovelImports,
  scaleRunForScript,
  sortPeerHits,
  normalizePeerHitInput,
  normalizePeerHitPlatform,
  normalizeVideoKey,
  parsePlayCount,
  parsePublishedAt,
  peerHitPublishedAt,
  pickFirst,
  publishedAtFromTikTokId
} from "./peer-hits.js";

test("reads Chinese and English import fields", () => {
  const hit = normalizePeerHitInput({
    视频链接: "https://www.tiktok.com/@peer/video/1234567890?q=1",
    播放量: "12.3万",
    小说名称: "My Husband Stole My Lifespan for His Ex",
    小说id: "5070518208",
    平台: "GoodNovel",
    视频数据: { 点赞: 880, 评论: 21 }
  }, { now: 1, id: "peer-1" });
  assert.equal(hit.videoUrl, "https://www.tiktok.com/@peer/video/1234567890?q=1");
  assert.equal(hit.videoKey, "tiktok:1234567890");
  assert.equal(hit.playCount, 123000);
  assert.equal(hit.novelTitle, "My Husband Stole My Lifespan for His Ex");
  assert.equal(hit.novelId, "5070518208");
  assert.equal(hit.platform, "GoodNovel");
  assert.equal(hit.videoData.点赞, 880);
  assert.equal(hit.videoData.评论, 21);
});

test("parses compact play counts", () => {
  assert.equal(parsePlayCount("1.2M"), 1_200_000);
  assert.equal(parsePlayCount("8.5k"), 8500);
  assert.equal(parsePlayCount("1,234"), 1234);
  assert.equal(parsePlayCount(88), 88);
});

test("normalizes tiktok video urls to the same key", () => {
  assert.equal(
    normalizeVideoKey("https://www.tiktok.com/@a/video/99"),
    normalizeVideoKey("https://tiktok.com/@b/video/99?lang=en")
  );
});

test("accepts a single object or a wrapped list", () => {
  assert.equal(collectImportItems({ 视频链接: "https://tiktok.com/@a/video/1" }).length, 1);
  assert.equal(collectImportItems({ items: [{ url: "https://tiktok.com/@a/video/1" }, { url: "https://tiktok.com/@a/video/2" }] }).length, 2);
});

test("matches factory novels by book id then title", () => {
  const novels = [
    { id: "n1", title: "Alpha", bookId: "111", platform: "GoodNovel" },
    { id: "n2", title: "Beta Book", bookId: "222", platform: "MotoNovel" }
  ];
  assert.equal(attachFactoryNovel({ novelId: "222", novelTitle: "" }, novels).factoryNovelId, "n2");
  assert.equal(attachFactoryNovel({ novelId: "222", novelTitle: "" }, novels).platform, "MotoNovel");
  assert.equal(attachFactoryNovel({ novelId: "", novelTitle: "Alpha" }, novels).factoryNovelId, "n1");
  assert.equal(attachFactoryNovel({ novelId: "999", novelTitle: "Missing" }, novels).factoryNovelId, "");
});

test("matches the same book id to the selected platform", () => {
  const novels = [
    { id: "n-good", title: "Shared", bookId: "111", platform: "GoodNovel" },
    { id: "n-moto", title: "Shared", bookId: "111", platform: "MotoNovel" }
  ];
  assert.equal(attachFactoryNovel({ novelId: "111", platform: "MotoNovel" }, novels).factoryNovelId, "n-moto");
  assert.equal(attachFactoryNovel({ novelId: "111", platform: "GoodNovel" }, novels).factoryNovelId, "n-good");
  assert.equal(attachFactoryNovel({ novelId: "111", novelTitle: "Shared" }, novels).factoryNovelId, "");
  assert.equal(normalizePeerHitPlatform("MasterNovel"), "NovelMaster");
  assert.equal(normalizePeerHitInput({
    videoUrl: "https://www.tiktok.com/@a/video/8",
    platform: "MasterNovel"
  }, { now: 1, id: "peer-plat" }).platform, "NovelMaster");
});

test("filters peer hits by novel platform", () => {
  const items = [
    { id: "a", platform: "GoodNovel" },
    { id: "b", platform: "MotoNovel" },
    { id: "c", platform: "NovelMaster" }
  ];
  assert.deepEqual(filterPeerHitsByPlatform(items, "MotoNovel").map((item) => item.id), ["b"]);
  assert.equal(filterPeerHitsByPlatform(items, "all").length, 3);
});

test("same video updates play count instead of duplicating", () => {
  const first = normalizePeerHitInput({ videoUrl: "https://www.tiktok.com/@a/video/7", playCount: 10 }, { now: 1, id: "peer-old" });
  const next = normalizePeerHitInput({ videoUrl: "https://tiktok.com/@a/video/7", playCount: 99, likes: 3 }, { now: 2, id: "peer-new" });
  const merged = mergePeerHit(first, { ...next, id: first.id });
  assert.equal(merged.id, "peer-old");
  assert.equal(merged.playCount, 99);
  assert.equal(merged.videoData.likes, 3);
  assert.equal(merged.importedAt, 1);
});

test("keeps an imported audio when the same video is updated", () => {
  const first = { id: "peer-old", audioId: "peer-old", audioName: "hit.mp3", audioSize: 2048, playCount: 10, videoData: {} };
  const next = { id: "peer-new", playCount: 99, videoData: { likes: 3 } };
  const merged = mergePeerHit(first, next);
  assert.equal(merged.audioId, "peer-old");
  assert.equal(merged.audioName, "hit.mp3");
  assert.equal(merged.playCount, 99);
});

test("filters by novel name or video url", () => {
  const items = [
    { novelTitle: "Alpha", novelId: "1", videoUrl: "https://tiktok.com/a", playCount: 9, videoData: {} },
    { novelTitle: "Beta", novelId: "2", videoUrl: "https://tiktok.com/b", playCount: 8, videoData: {} }
  ];
  assert.deepEqual(filterPeerHits(items, "beta").map((item) => item.novelId), ["2"]);
});

test("time filter keeps recent imports", () => {
  const now = Date.parse("2026-08-27T12:00:00+08:00");
  const items = [
    { id: "old", importedAt: now - 10 * 86_400_000, playCount: 9 },
    { id: "week", importedAt: now - 3 * 86_400_000, playCount: 8 },
    { id: "today", importedAt: now - 2 * 3_600_000, playCount: 7 }
  ];
  assert.deepEqual(filterPeerHitsByTime(items, "today", now).map((item) => item.id), ["today"]);
  assert.deepEqual(filterPeerHitsByTime(items, "7d", now).map((item) => item.id), ["week", "today"]);
  assert.equal(filterPeerHitsByTime(items, "all", now).length, 3);
  assert.deepEqual(filterPeerHitsByTime(items, "all", now, now - 4 * 86_400_000).map((item) => item.id), ["week", "today"]);
});

test("sorts peer hits by play count descending", () => {
  const items = [
    { id: "low", playCount: 8, updatedAt: 9 },
    { id: "high", playCount: 99, updatedAt: 1 },
    { id: "mid", playCount: 20, updatedAt: 8 }
  ];
  assert.deepEqual(sortPeerHits(items).map((item) => item.id), ["high", "mid", "low"]);
});

test("plans novel imports by book id and skips missing audio", () => {
  const novels = [{ id: "n1", title: "Alpha", bookId: "111", platform: "GoodNovel" }];
  const plan = planPeerHitNovelImports([
    { id: "h1", audioId: "peer-1", novelId: "111", platform: "GoodNovel", novelTitle: "Alpha" },
    { id: "h2", audioId: "", novelId: "111", platform: "GoodNovel", novelTitle: "Alpha" },
    { id: "h3", audioId: "peer-3", novelId: "999", platform: "GoodNovel", novelTitle: "Missing" }
  ], novels);
  assert.equal(plan[0].novel.id, "n1");
  assert.match(plan[1].skipReason, /还没有爆款音频/);
  assert.match(plan[2].skipReason, /对不上书单/);
  assert.match(planPeerHitNovelImports([
    { id: "h4", audioId: "peer-4", novelId: "111", platform: "MotoNovel", novelTitle: "Alpha" }
  ], novels)[0].skipReason, /对不上书单/);
});

test("marks peer hits already written to a novel audio board", () => {
  const imported = importedPeerHitIdSet([
    { peerHitId: "h1", audioId: "upload-1" },
    { peerHitId: "h2", audioId: "" },
    { peerHitId: "", audioId: "upload-3" }
  ]);
  assert.deepEqual([...imported], ["h1"]);
  assert.equal(attachAudioBoardImportStatus({ id: "h1" }, imported).importedToAudioBoard, true);
  assert.equal(attachAudioBoardImportStatus({ id: "h2" }, imported).importedToAudioBoard, false);
  assert.match(planPeerHitNovelImports(
    [{ id: "h1", audioId: "peer-1", novelId: "111", platform: "GoodNovel", novelTitle: "Alpha" }],
    [{ id: "n1", title: "Alpha", bookId: "111", platform: "GoodNovel" }],
    { importedPeerHitIds: imported }
  )[0].skipReason, /已经写入音频页/);
});

test("skips peer-hit import when the same source file is already on that book", () => {
  const novels = [{ id: "n1", title: "Alpha", bookId: "111", platform: "GoodNovel" }];
  const tokens = importedSourceTokensByNovel([
    {
      novelId: "n1",
      title: "Alpha 111_7664612119932833038",
      text: "Uploaded audio for this novel opening. Source file: 111_7664612119932833038.mp3."
    }
  ]);
  assert.deepEqual([...tokens.get("n1")], ["111_7664612119932833038"]);
  assert.match(planPeerHitNovelImports(
    [{ id: "h9", audioId: "peer-9", novelId: "111", platform: "GoodNovel", novelTitle: "Alpha", audioName: "111_7664612119932833038.mp3" }],
    novels,
    { importedSourceTokensByNovel: tokens }
  )[0].skipReason, /已经写入音频页/);
});

test("skips peer-hit import when the book already has a near-identical clip", () => {
  const novels = [{ id: "n1", title: "Alpha", bookId: "111", platform: "GoodNovel" }];
  const fingerprints = importedClipFingerprintsByNovel([
    { novelId: "n1", audio: { size: 7843884, duration: 490.187 } }
  ]);
  assert.match(planPeerHitNovelImports(
    [{ id: "h8", audioId: "peer-8", novelId: "111", platform: "GoodNovel", novelTitle: "Alpha", audioSize: 7846809, audioDuration: 490.37 }],
    novels,
    { importedClipFingerprintsByNovel: fingerprints }
  )[0].skipReason, /已经写入音频页/);
});

test("marks the same audio across multiple videos as a scale run", () => {
  const marked = attachScaleRunMarks(attachPeerHitTimes([
    { id: "h1", factoryNovelId: "n1", audioId: "a1", audioSize: 7843884, playCount: 561500, videoUrl: "https://www.tiktok.com/@a/video/7665161307120766222" },
    { id: "h2", factoryNovelId: "n1", audioId: "a2", audioSize: 7846809, playCount: 220600, videoUrl: "https://www.tiktok.com/@b/video/7670570595171454229" },
    { id: "h3", factoryNovelId: "n1", audioId: "a3", audioSize: 1_200_000, playCount: 9 }
  ]));
  assert.equal(marked[0].scaleRun.videoCount, 2);
  assert.equal(marked[1].scaleRun.playCount, 782100);
  assert.equal(marked[2].scaleRun, undefined);
  assert.equal(marked[0].scaleRun.videos.length, 2);
  assert.equal(marked[0].scaleRun.videos[0].id, "h1");
  assert.equal(marked[0].scaleRun.videos[0].playCount, 561500);
  assert.ok(marked[0].scaleRun.videos[0].publishedAt > 0);
  assert.deepEqual(scaleRunForScript({ peerHitId: "h1", audio: { size: 7843884 } }, marked), marked[0].scaleRun);
});

test("derives TikTok publish time from the video id", () => {
  const publishedAt = publishedAtFromTikTokId("7665161307120766222");
  assert.equal(publishedAt, Number(BigInt("7665161307120766222") >> 32n) * 1000);
  assert.equal(new Date(publishedAt).toISOString().slice(0, 10), "2026-07-22");
  assert.equal(parsePublishedAt("2026-07-22T09:40:40+08:00"), Date.parse("2026-07-22T09:40:40+08:00"));
});

test("prefers recorded publish time over the TikTok video id", () => {
  const recorded = Date.parse("2026-06-01T12:00:00+08:00");
  assert.equal(peerHitPublishedAt({
    videoUrl: "https://www.tiktok.com/@a/video/7665161307120766222",
    videoData: { 发布时间: recorded }
  }), recorded);
  assert.equal(normalizePeerHitInput({
    videoUrl: "https://www.tiktok.com/@a/video/7665161307120766222",
    发布时间: recorded
  }, { now: 1, id: "peer-time" }).videoData.发布时间, recorded);
});

test("writes publish time into video data on import and later scrape updates", () => {
  const fromId = publishedAtFromTikTokId("7665161307120766222");
  const imported = normalizePeerHitInput({
    videoUrl: "https://www.tiktok.com/@a/video/7665161307120766222",
    playCount: 100
  }, { now: 1, id: "peer-write" });
  assert.equal(imported.videoData.发布时间, fromId);

  const fromCreateTime = normalizePeerHitInput({
    videoUrl: "https://www.tiktok.com/@a/video/1",
    videoData: { createTime: 1_753_171_240, 点赞: 8 }
  }, { now: 1, id: "peer-create" });
  assert.equal(fromCreateTime.videoData.发布时间, 1_753_171_240_000);
  assert.equal(fromCreateTime.videoData.点赞, 8);

  const merged = mergePeerHit(
    { id: "peer-old", videoUrl: imported.videoUrl, videoData: { 点赞: 1 }, playCount: 10 },
    { id: "peer-new", videoUrl: imported.videoUrl, videoData: { 点赞: 2 }, playCount: 20, updatedAt: 2 }
  );
  assert.equal(merged.videoData.发布时间, fromId);
  assert.equal(merged.videoData.点赞, 2);

  const planned = planPeerHitPublishedAtWrites([
    { id: "missing", videoUrl: imported.videoUrl, videoData: { 点赞: 1 } },
    { id: "ready", videoUrl: imported.videoUrl, videoData: { 发布时间: fromId } }
  ]);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].id, "missing");
  assert.equal(planned[0].publishedAt, fromId);
});

test("pickFirst skips empty values", () => {
  assert.equal(pickFirst({ 播放量: "", playCount: "10" }, ["播放量", "playCount"]), "10");
});
