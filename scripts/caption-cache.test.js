import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captionCacheKey, captionCachePath, makeCaptionCues, writeCaptionCache } from "./caption-cache.js";

test("caption cache key matches reddit-mix scribe_v2 hashing", () => {
  const audio = Buffer.from("same-audio-bytes");
  const expected = crypto.createHash("sha256")
    .update("reddit-mix-caption-cache-v1")
    .update("\0")
    .update("scribe_v2")
    .update("\0")
    .update(audio)
    .digest("hex");
  assert.equal(captionCacheKey(audio), expected);
});

test("writeCaptionCache stores kokoro word timings for the final audio file", (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "caption-cache-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const audioPath = path.join(workDir, "speech.mp3");
  fs.writeFileSync(audioPath, Buffer.alloc(2048, 3));
  const cachePath = writeCaptionCache(workDir, audioPath, {
    provider: "kokoro",
    model: "kokoro-82m",
    text: "The letter arrived",
    words: [
      { text: "The", start: 0, end: 0.2 },
      { text: "letter", start: 0.2, end: 0.5 },
      { text: "arrived", start: 0.5, end: 0.9 }
    ]
  });
  assert.equal(cachePath, captionCachePath(workDir, audioPath));
  const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.equal(cached.provider, "kokoro");
  assert.equal(cached.words.length, 3);
  assert.ok(cached.cues.length >= 1);
  assert.match(cached.cues[0].text, /The/);
});

test("makeCaptionCues groups nearby words and breaks on punctuation", () => {
  const cues = makeCaptionCues([
    { text: "Hello", start: 0, end: 0.3 },
    { text: "there.", start: 0.3, end: 0.6 },
    { text: "Next", start: 1.2, end: 1.4 }
  ]);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, "Hello there.");
  assert.equal(cues[1].text, "Next");
});

test("makeCaptionCues drops punctuation-only tokens", () => {
  const cues = makeCaptionCues([
    { text: "twelve", start: 5.0, end: 5.8 },
    { text: ".", start: 5.8, end: 5.97 }
  ]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, "twelve");
});
