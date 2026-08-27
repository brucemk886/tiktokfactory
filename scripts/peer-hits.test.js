import assert from "node:assert/strict";
import test from "node:test";
import {
  attachAudioBoardImportStatus,
  attachFactoryNovel,
  collectImportItems,
  filterPeerHits,
  filterPeerHitsByPlatform,
  filterPeerHitsByTime,
  importedPeerHitIdSet,
  mergePeerHit,
  planPeerHitNovelImports,
  sortPeerHits,
  normalizePeerHitInput,
  normalizePeerHitPlatform,
  normalizeVideoKey,
  parsePlayCount,
  pickFirst
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

test("pickFirst skips empty values", () => {
  assert.equal(pickFirst({ 播放量: "", playCount: "10" }, ["播放量", "playCount"]), "10");
});
