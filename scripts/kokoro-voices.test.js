import assert from "node:assert/strict";
import test from "node:test";
import { KOKORO_VOICES, kokoroLangCode, listKokoroVoices, normalizeTtsProvider, resolveVoiceForProvider } from "./kokoro-voices.js";

test("tts provider defaults to kokoro and keeps elevenlabs when asked", () => {
  assert.equal(normalizeTtsProvider(""), "kokoro");
  assert.equal(normalizeTtsProvider("elevenlabs"), "elevenlabs");
  assert.equal(resolveVoiceForProvider("kokoro", "cgSgspJ2msm6clMCkdW9"), "am_michael");
  assert.equal(resolveVoiceForProvider("kokoro", "af_bella"), "af_bella");
  assert.equal(resolveVoiceForProvider("elevenlabs", "cgSgspJ2msm6clMCkdW9"), "cgSgspJ2msm6clMCkdW9");
});

test("kokoro voice list is UI-shaped and does not need an API key", () => {
  const listed = listKokoroVoices({ defaultVoiceId: "af_heart" });
  assert.equal(listed.defaultVoiceId, "af_heart");
  assert.ok(listed.voices.every((voice) => Array.isArray(voice.languages)));
  assert.ok(listed.filters.languages[0].value);
  assert.ok(listed.filters.genders.some((item) => item.label === "男性"));
  assert.equal(listed.voices.find((voice) => voice.id === "am_michael").previewUrl, "/kokoro-previews/am_michael.mp3");
  assert.equal(KOKORO_VOICES.length, 28);
  assert.ok(listed.voices.some((voice) => voice.id === "af_jessica"));
  assert.ok(listed.voices.some((voice) => voice.id === "bm_fable"));
  assert.equal(listed.voices.find((voice) => voice.id === "bf_alice").previewUrl, "/kokoro-previews/bf_alice.mp3");
  assert.equal(kokoroLangCode("bf_emma"), "b");
  assert.equal(kokoroLangCode("am_michael"), "a");
});
