import assert from "node:assert/strict";
import test from "node:test";
import { novelAudioObjectKey, putNovelAudio } from "./novel-audio-archive.js";

test("novel audio object keys stay inside the R2 prefix", () => {
  assert.equal(novelAudioObjectKey("script-abc-123"), "novel-audio/script-abc-123.mp3");
  assert.equal(novelAudioObjectKey(" ../evil/id "), "novel-audio/evilid.mp3");
  assert.equal(novelAudioObjectKey(""), "");
  assert.equal(novelAudioObjectKey("a".repeat(200)).length, "novel-audio/".length + 120 + ".mp3".length);
});

test("putNovelAudio writes mp3 bytes into ARCHIVE", async () => {
  const stored = {};
  const result = await putNovelAudio({
    ARCHIVE: {
      async put(key, body, options) {
        stored.key = key;
        stored.body = body;
        stored.type = options.httpMetadata.contentType;
      }
    }
  }, "script-abc", "bytes", "audio/mpeg");
  assert.equal(result.key, "novel-audio/script-abc.mp3");
  assert.equal(stored.key, "novel-audio/script-abc.mp3");
  assert.equal(stored.body, "bytes");
  assert.equal(stored.type, "audio/mpeg");
});
