import assert from "node:assert/strict";
import test from "node:test";
import { listElevenLabsVoices } from "./elevenlabs-voices.js";

test("lists ElevenLabs voices from the public API without a worker hop", async () => {
  const result = await listElevenLabsVoices({
    apiKey: "test-key",
    defaultVoiceId: "voice-default",
    fetchImpl: async (url) => {
      assert.match(String(url), /elevenlabs\.io/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          voices: [
            { voice_id: "voice-1", name: "Rachel", category: "premade", labels: { gender: "female", language: "en" }, preview_url: "https://example.com/a.mp3" }
          ]
        })
      };
    }
  });
  assert.equal(result.voices[0].id, "voice-1");
  assert.equal(result.voices[0].name, "Rachel");
  assert.equal(result.defaultVoiceId, "voice-default");
  assert.equal(result.filters.genders[0].value, "female");
});
