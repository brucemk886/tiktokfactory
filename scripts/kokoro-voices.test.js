import assert from "node:assert/strict";
import test from "node:test";
import { listKokoroVoices, normalizeTtsProvider, resolveVoiceForProvider } from "./kokoro-voices.js";

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
});
