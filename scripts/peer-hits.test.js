import assert from "node:assert/strict";
import test from "node:test";
import {
  attachFactoryNovel,
  collectImportItems,
  filterPeerHits,
  mergePeerHit,
  normalizePeerHitInput,
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
    视频数据: { 点赞: 880, 评论: 21 }
  }, { now: 1, id: "peer-1" });
  assert.equal(hit.videoUrl, "https://www.tiktok.com/@peer/video/1234567890?q=1");
  assert.equal(hit.videoKey, "tiktok:1234567890");
  assert.equal(hit.playCount, 123000);
  assert.equal(hit.novelTitle, "My Husband Stole My Lifespan for His Ex");
  assert.equal(hit.novelId, "5070518208");
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
    { id: "n1", title: "Alpha", bookId: "111" },
    { id: "n2", title: "Beta Book", bookId: "222" }
  ];
  assert.equal(attachFactoryNovel({ novelId: "222", novelTitle: "" }, novels).factoryNovelId, "n2");
  assert.equal(attachFactoryNovel({ novelId: "", novelTitle: "Alpha" }, novels).factoryNovelId, "n1");
  assert.equal(attachFactoryNovel({ novelId: "999", novelTitle: "Missing" }, novels).factoryNovelId, "");
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

test("pickFirst skips empty values", () => {
  assert.equal(pickFirst({ 播放量: "", playCount: "10" }, ["播放量", "playCount"]), "10");
});
