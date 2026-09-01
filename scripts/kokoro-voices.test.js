import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_KOKORO_FEMALE_VOICE, DEFAULT_KOKORO_MALE_VOICE, KOKORO_VOICES, kokoroLangCode, listKokoroVoices, normalizeNarratorGender, normalizeTtsProvider, resolveVoiceForNarrator, resolveVoiceForProvider } from "./kokoro-voices.js";

test("tts provider defaults to kokoro and keeps elevenlabs when asked", () => {
  assert.equal(normalizeTtsProvider(""), "kokoro");
  assert.equal(normalizeTtsProvider("elevenlabs"), "elevenlabs");
  assert.equal(resolveVoiceForProvider("kokoro", "cgSgspJ2msm6clMCkdW9"), "am_adam");
  assert.equal(resolveVoiceForProvider("kokoro", ""), "am_adam");
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
  assert.equal(listed.defaultMaleVoiceId, DEFAULT_KOKORO_MALE_VOICE);
  assert.equal(listed.defaultFemaleVoiceId, DEFAULT_KOKORO_FEMALE_VOICE);
  assert.match(listed.voices.find((voice) => voice.id === "am_adam").name, /默认男声/);
  assert.match(listed.voices.find((voice) => voice.id === "af_jessica").name, /默认女声/);
});

test("narrator gender picks matching kokoro defaults and keeps a same-gender voice", () => {
  assert.equal(normalizeNarratorGender(""), "male");
  assert.equal(normalizeNarratorGender("female"), "female");
  assert.equal(resolveVoiceForNarrator("kokoro", "", "female"), DEFAULT_KOKORO_FEMALE_VOICE);
  assert.equal(resolveVoiceForNarrator("kokoro", "am_adam", "female"), DEFAULT_KOKORO_FEMALE_VOICE);
  assert.equal(resolveVoiceForNarrator("kokoro", "af_bella", "female"), "af_bella");
  assert.equal(resolveVoiceForNarrator("kokoro", "af_jessica", "male"), DEFAULT_KOKORO_MALE_VOICE);
  assert.equal(resolveVoiceForNarrator("elevenlabs", "cgSgspJ2msm6clMCkdW9", "female"), "cgSgspJ2msm6clMCkdW9");
});
