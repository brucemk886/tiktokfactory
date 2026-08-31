import assert from "node:assert/strict";
import test from "node:test";
import { normalizeScribeWords, transcribeAudioBuffer } from "./scribe-transcribe.js";

test("scribe words drop punctuation-only tokens and keep timed words", () => {
  const words = normalizeScribeWords([
    { text: ".", start: 0, end: 0.1 },
    { text: "She", start: 0.1, end: 0.3 },
    { word: "lied", start_time: 0.3, end_time: 0.6 }
  ]);
  assert.deepEqual(words.map((item) => item.text), ["She", "lied"]);
});

test("transcribeAudioBuffer posts the audio and returns spoken text", async () => {
  const calls = [];
  const result = await transcribeAudioBuffer({
    apiKey: "el-key",
    audioBuffer: new Uint8Array(2048).fill(7),
    fileName: "peer.mp3",
    fetchImpl: async (url, options) => {
      calls.push({ url, key: options.headers["xi-api-key"], body: options.body });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            text: "She spread a dirty lie about me in front of everyone.",
            words: [
              { text: "She", start: 0, end: 0.2 },
              { text: "spread", start: 0.2, end: 0.5 }
            ]
          });
        }
      };
    }
  });
  assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/speech-to-text");
  assert.equal(calls[0].key, "el-key");
  assert.ok(calls[0].body instanceof FormData);
  assert.equal(result.text, "She spread a dirty lie about me in front of everyone.");
  assert.equal(result.words.length, 2);
  assert.equal(result.provider, "elevenlabs");
});

test("transcribeAudioBuffer rejects a missing API key", async () => {
  await assert.rejects(
    () => transcribeAudioBuffer({ apiKey: "", audioBuffer: new Uint8Array(2048) }),
    /未配置/
  );
});
