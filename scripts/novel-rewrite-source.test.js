import assert from "node:assert/strict";
import test from "node:test";
import { uploadedAudioScriptText } from "./novel-audio-import.js";
import {
  firstReadyPeerRewriteScript,
  isReadyPeerRewriteScript,
  peerRewriteOpeningPayload,
  resolveBatchPeerRewriteJobs,
  resolvePeerRewriteSource
} from "./novel-rewrite-source.js";

const readyText = "The comments told him to take the other girl, and he did it on live while I stood there holding the ring he promised me last winter.";

function novelWith(scripts) {
  return {
    id: "novel-1",
    title: "Sold Tonight",
    category: "Drama",
    platform: "GoodNovel",
    promotionCode: "GN-1",
    sellingPoint: "revenge",
    sourceContent: "This free chapter should never be used as the rewrite source anymore because the user now rewrites from peer hit audio.",
    scripts
  };
}

test("only a ready peer-hit transcript can be the rewrite source", () => {
  assert.equal(isReadyPeerRewriteScript({
    sourceType: "peer-hit",
    transcriptStatus: "ready",
    text: readyText
  }), true);
  assert.equal(isReadyPeerRewriteScript({
    sourceType: "peer-hit",
    transcriptStatus: "pending",
    text: readyText
  }), false);
  assert.equal(isReadyPeerRewriteScript({
    sourceType: "peer-hit",
    transcriptStatus: "ready",
    text: uploadedAudioScriptText("hit.mp3")
  }), false);
  assert.equal(isReadyPeerRewriteScript({
    sourceType: "ai-style-rewrite",
    transcriptStatus: "ready",
    text: readyText
  }), false);
});

test("resolvePeerRewriteSource uses the checked peer transcript instead of free chapters", () => {
  const novel = novelWith([
    { id: "peer-1", sourceType: "peer-hit", transcriptStatus: "ready", text: readyText, versionLabel: "同行爆款" }
  ]);
  const source = resolvePeerRewriteSource(novel, "peer-1");
  assert.equal(source.sourceKind, "peer-transcript");
  assert.equal(source.sourceText, readyText);
  assert.equal(source.parentScriptId, "peer-1");
  assert.equal(source.sourceText.includes("free chapter"), false);
});

test("missing or unfinished peer audio is rejected", () => {
  const novel = novelWith([
    { id: "peer-1", sourceType: "peer-hit", transcriptStatus: "pending", text: uploadedAudioScriptText("hit.mp3") }
  ]);
  assert.throws(() => resolvePeerRewriteSource(novel, ""), /勾选一条已识别完成的同行爆款口播/);
  assert.throws(() => resolvePeerRewriteSource(novel, "peer-1"), /还在识别中/);
  assert.throws(() => resolvePeerRewriteSource(novel, "missing"), /没有找到勾选的同行爆款口播/);
});

test("auto-pick uses the first ready peer transcript", () => {
  const novel = novelWith([
    { id: "peer-pending", sourceType: "peer-hit", transcriptStatus: "pending", text: uploadedAudioScriptText("hit.mp3") },
    { id: "peer-ready", sourceType: "peer-hit", transcriptStatus: "ready", text: readyText, versionLabel: "同行爆款" }
  ]);
  assert.equal(firstReadyPeerRewriteScript(novel).id, "peer-ready");
  const payload = peerRewriteOpeningPayload(novel, { styles: ["auto"], autoPickPeer: true });
  assert.equal(payload.sourceScriptId, "peer-ready");
  assert.equal(payload.sourceText, readyText);
});

test("batch rewrite plans one job per novel and skips books without a ready peer", () => {
  const ready = novelWith([
    { id: "peer-2", sourceType: "peer-hit", transcriptStatus: "ready", text: readyText, versionLabel: "同行爆款" }
  ]);
  ready.id = "novel-ready";
  const pending = novelWith([
    { id: "peer-wait", sourceType: "peer-hit", transcriptStatus: "pending", text: uploadedAudioScriptText("hit.mp3") }
  ]);
  pending.id = "novel-wait";
  const items = resolveBatchPeerRewriteJobs(new Map([
    [ready.id, ready],
    [pending.id, pending]
  ]), {
    novelIds: [ready.id, pending.id],
    styles: ["auto"],
    autoPickPeer: true
  });
  assert.equal(items[0].skipped, false);
  assert.equal(items[0].payload.sourceScriptId, "peer-2");
  assert.equal(items[1].skipped, true);
  assert.match(items[1].reason, /勾选一条已识别完成的同行爆款口播/);
});

test("opening payload sends the peer transcript, not novel.sourceContent", () => {
  const novel = novelWith([
    { id: "peer-2", sourceType: "peer-hit", transcriptStatus: "ready", text: readyText, openingTitle: "He did it on live" }
  ]);
  const payload = peerRewriteOpeningPayload(novel, {
    sourceScriptId: "peer-2",
    styles: ["auto"],
    model: "gpt-5.6-sol"
  });
  assert.equal(payload.sourceText, readyText);
  assert.equal(payload.sourceKind, "peer-transcript");
  assert.equal(payload.sourceScriptId, "peer-2");
  assert.equal(payload.baseOpening, "");
  assert.notEqual(payload.sourceText, novel.sourceContent);
});
