import assert from "node:assert/strict";
import test from "node:test";
import { copyNovelAudio, deleteNovelAudio, novelAudioObjectKey, putNovelAudio } from "./novel-audio-archive.js";

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

test("copyNovelAudio copies bytes to a new object key", async () => {
  const stored = {};
  const result = await copyNovelAudio({
    ARCHIVE: {
      async get(key) {
        assert.equal(key, "novel-audio/peer-1.mp3");
        return { body: "hit-bytes", size: 9, httpMetadata: { contentType: "audio/mpeg" } };
      },
      async put(key, body, options) {
        stored.key = key;
        stored.body = body;
        stored.type = options.httpMetadata.contentType;
      }
    }
  }, "peer-1", "upload-2");
  assert.equal(result.key, "novel-audio/upload-2.mp3");
  assert.equal(result.size, 9);
  assert.equal(stored.key, "novel-audio/upload-2.mp3");
  assert.equal(stored.body, "hit-bytes");
});

test("deleteNovelAudio removes the R2 object", async () => {
  const deleted = [];
  const ok = await deleteNovelAudio({
    ARCHIVE: {
      async delete(key) {
        deleted.push(key);
      }
    }
  }, "script-abc");
  assert.equal(ok, true);
  assert.deepEqual(deleted, ["novel-audio/script-abc.mp3"]);
});
