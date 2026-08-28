import assert from "node:assert/strict";
import test from "node:test";
import {
  addAudioPlayCount,
  attachNovelHitStats,
  audioFileKey,
  buildAudioHitWeights,
  buildOwnHitSnapshot,
  peerStatsByNovelId
} from "./novel-hit-scores.js";

const novels = [
  { id: "n1", title: "Prison Story", platform: "NovelMaster", bookId: "479093", performance: { comments: 2 } },
  { id: "n2", title: "Quiet Book", platform: "GoodNovel", bookId: "11" }
];

test("audioFileKey uses lowercase basename", () => {
  assert.equal(audioFileKey("F:\\\\音频目录\\\\NovelMaster\\\\Hit Story.mp3"), "hit story.mp3");
  assert.equal(audioFileKey(""), "");
});

test("attachNovelHitStats merges peer and own plays onto book list rows", () => {
  const rows = attachNovelHitStats(novels, {
    peerHits: [
      { id: "p1", factoryNovelId: "n1", playCount: 2_800_000, audioName: "Hit Story.mp3" },
      { id: "p2", platform: "NovelMaster", novelId: "479093", playCount: 120_000, audioName: "Other.mp3" }
    ],
    ownByNovelId: {
      n1: { playCount: 860, maxViews: 420, videoCount: 3 }
    }
  });
  assert.equal(rows[0].ownPlayCount, 860);
  assert.equal(rows[0].peerPlayCount, 2_920_000);
  assert.equal(rows[0].peerVideoCount, 2);
  assert.equal(rows[0].hit, true);
  assert.equal(rows[0].hitLabel, "自有+同行");
  assert.equal(rows[0].performance.totalViews, 2_920_860);
  assert.equal(rows[1].hit, false);
  assert.equal(rows[1].peerPlayCount, 0);
});

test("peerStatsByNovelId matches platform book id when factory id is empty", () => {
  const byId = peerStatsByNovelId(novels, [
    { novelId: "479093", platform: "NovelMaster", playCount: 500_000 }
  ]);
  assert.equal(byId.get("n1").playCount, 500_000);
  assert.equal(byId.has("n2"), false);
});

test("buildAudioHitWeights keys peer and script file names", () => {
  const weights = buildAudioHitWeights({
    peerHits: [{ id: "p1", audioName: "Hit Story.mp3", playCount: 2_800_000 }],
    scripts: [{
      peerHitId: "p1",
      audio: { fileName: "Prison Story Hit Story.mp3", targetAudioPath: "F:/音频目录/a.mp3" }
    }],
    ownByAudioName: { "own-hit.mp3": 900 }
  });
  assert.equal(weights["hit story.mp3"], 2_800_000);
  assert.equal(weights["prison story hit story.mp3"], 2_800_000);
  assert.equal(weights["a.mp3"], 2_800_000);
  assert.equal(weights["own-hit.mp3"], 900);
});

test("buildOwnHitSnapshot copies overview performance onto audio names", () => {
  const snapshot = buildOwnHitSnapshot({
    novels: [{
      id: "n1",
      performance: { totalViews: 860, maxViews: 420, videoCount: 3 },
      scripts: [{ performance: { totalViews: 420 }, audio: { fileName: "Own Hit.mp3" } }]
    }]
  });
  assert.equal(snapshot.ownByNovelId.n1.playCount, 860);
  assert.equal(snapshot.ownByAudioName["own hit.mp3"], 420);
});

test("addAudioPlayCount keeps the higher play count", () => {
  const map = {};
  addAudioPlayCount(map, "Hook", 200);
  addAudioPlayCount(map, "Hook.mp3", 900);
  assert.equal(map["hook.mp3"], 900);
});
