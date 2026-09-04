import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TTS_READBACK_FILE, checkTtsReadback, normalizeSpeechText, recordTtsReadbackFailure, wordErrorRate } from "./tts-readback.js";

const script = "My sister stole my wedding date. I found out from a group chat, not from her. Search 479093 on the Novel Master app to read the full story.";

test("word error rate ignores punctuation, case and spelled-out small numbers", () => {
  assert.equal(wordErrorRate(script, script.toUpperCase().replace(/\./g, "")), 0);
  assert.equal(wordErrorRate("I have three cats", "i have 3 cats"), 0);
  assert.equal(wordErrorRate("a b c d", "a b x d"), 0.25);
  assert.equal(wordErrorRate("", "anything"), 1);
  assert.deepEqual(normalizeSpeechText("Don't stop, it's two o'clock!"), ["dont", "stop", "its", "2", "oclock"]);
});

test("a faithful transcript passes, a mangled one fails, no script means no check", () => {
  const faithful = { text: "My sister stole my wedding date. I found out from a group chat not from her. Search 479093 on the novel master app to read the full story" };
  const ok = checkTtsReadback({ scriptText: script, transcript: faithful, maxWordErrorRate: 0.25 });
  assert.equal(ok.checked, true);
  assert.equal(ok.ok, true);
  assert.ok(ok.wer < 0.05);

  const mangled = { cues: [{ text: "My sister stole my wedding" }, { text: "I found out from her" }, { text: "search four seven on the master to read" }] };
  const bad = checkTtsReadback({ scriptText: script, transcript: mangled, maxWordErrorRate: 0.25 });
  assert.equal(bad.checked, true);
  assert.equal(bad.ok, false);
  assert.ok(bad.wer > 0.4);

  const noScript = checkTtsReadback({ scriptText: "", transcript: faithful });
  assert.equal(noScript.checked, false);
  assert.equal(noScript.ok, true);
});

test("readback failures are logged per audio for review", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tts-readback-"));
  recordTtsReadbackFailure(workDir, { audioPath: "F:/audio/a.mp3", wer: 0.4, limit: 0.25, at: 1 });
  recordTtsReadbackFailure(workDir, { audioPath: "F:/audio/b.mp3", wer: 0.5, limit: 0.25, at: 2 });
  recordTtsReadbackFailure(workDir, { audioPath: "F:/audio/a.mp3", wer: 0.45, limit: 0.25, at: 3 });
  const state = JSON.parse(fs.readFileSync(path.join(workDir, TTS_READBACK_FILE), "utf8"));
  assert.equal(state.failures.length, 2);
  assert.equal(state.failures.find((item) => item.audioPath === "F:/audio/a.mp3").wer, 0.45);
  fs.rmSync(workDir, { recursive: true, force: true });
});
