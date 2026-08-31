import assert from "node:assert/strict";
import test from "node:test";
import { uploadedAudioScriptText } from "./novel-audio-import.js";
import {
  enqueueExistingImportedTranscripts,
  isStaleTranscriptRun,
  needsQueuedSpeechTranscript,
  pickNextQueuedTranscript,
  shouldEnqueueExistingImportedTranscript,
  summarizeTranscriptQueue
} from "./scribe-queue.js";

test("queued transcripts skip ready, failed, and live running items", () => {
  assert.equal(needsQueuedSpeechTranscript({
    sourceType: "peer-hit",
    audioId: "a1",
    text: uploadedAudioScriptText("a.mp3"),
    transcriptStatus: "pending"
  }), true);
  assert.equal(needsQueuedSpeechTranscript({
    sourceType: "uploaded-audio",
    audioId: "a1",
    text: uploadedAudioScriptText("a.mp3"),
    transcriptStatus: "pending"
  }), true);
  assert.equal(needsQueuedSpeechTranscript({
    sourceType: "peer-hit",
    audioId: "a1",
    text: uploadedAudioScriptText("a.mp3"),
    transcriptStatus: "failed"
  }), false);
  assert.equal(needsQueuedSpeechTranscript({
    sourceType: "peer-hit",
    audioId: "a1",
    text: "She spread a dirty lie about me in front of everyone.",
    transcriptStatus: "ready"
  }), false);
  assert.equal(needsQueuedSpeechTranscript({
    sourceType: "peer-hit",
    audioId: "a1",
    text: uploadedAudioScriptText("old.mp3"),
    transcriptStatus: "ready"
  }), true);
});

test("existing imported pass queues failed and placeholder-ready clips once", () => {
  const now = Date.parse("2026-08-31T07:00:00.000Z");
  const ready = {
    id: "ready",
    sourceType: "peer-hit",
    audioId: "a1",
    transcriptStatus: "ready",
    text: "She spread a dirty lie about me in front of everyone."
  };
  const failed = {
    id: "failed",
    sourceType: "peer-hit",
    audioId: "a2",
    transcriptStatus: "failed",
    text: uploadedAudioScriptText("b.mp3")
  };
  const fakeReady = {
    id: "fake",
    sourceType: "uploaded-audio",
    audioId: "a3",
    transcriptStatus: "ready",
    text: uploadedAudioScriptText("c.mp3")
  };
  assert.equal(shouldEnqueueExistingImportedTranscript(ready, now), false);
  assert.equal(shouldEnqueueExistingImportedTranscript(failed, now), true);
  const ids = enqueueExistingImportedTranscripts([ready, failed, fakeReady], now);
  assert.deepEqual(ids, ["failed", "fake"]);
  assert.equal(failed.transcriptStatus, "pending");
  assert.equal(fakeReady.transcriptStatus, "pending");
  assert.equal(ready.transcriptStatus, "ready");
});

test("picks more queued scripts until ten imported clips are running", () => {
  const now = Date.parse("2026-08-31T06:00:00.000Z");
  const pending = {
    id: "s2",
    sourceType: "peer-hit",
    audioId: "a2",
    transcriptStatus: "pending",
    text: uploadedAudioScriptText("b.mp3")
  };
  const running = (id) => ({
    id,
    sourceType: "peer-hit",
    audioId: id,
    transcriptStatus: "running",
    updatedAt: "2026-08-31T05:59:00.000Z"
  });
  const live = Array.from({ length: 10 }, (_, index) => running(`r${index}`));
  assert.equal(pickNextQueuedTranscript([pending, running("s1")], now).script.id, "s2");
  assert.equal(pickNextQueuedTranscript([pending], now).script.id, "s2");
  assert.equal(pickNextQueuedTranscript([pending, ...live.slice(0, 9)], now).script.id, "s2");
  assert.equal(pickNextQueuedTranscript([pending, ...live], now).busy, true);
});

test("stale running jobs can be claimed again", () => {
  const now = Date.parse("2026-08-31T06:10:00.000Z");
  const stale = {
    id: "s1",
    sourceType: "uploaded-audio",
    audioId: "a1",
    transcriptStatus: "running",
    updatedAt: "2026-08-31T06:00:00.000Z"
  };
  assert.equal(isStaleTranscriptRun(stale, now), true);
  assert.equal(pickNextQueuedTranscript([stale], now).script.id, "s1");
  assert.deepEqual(summarizeTranscriptQueue([stale, {
    sourceType: "peer-hit",
    audioId: "a2",
    transcriptStatus: "pending",
    text: uploadedAudioScriptText("c.mp3")
  }], now), { pending: 1, running: 0, failed: 0 });
});
