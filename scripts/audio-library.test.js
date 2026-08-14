import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAudioLibraryService } from "./audio-library.js";

test("audio library generates once and reuses the same ElevenLabs result", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-library-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(workDir, "novel-marketing"), { recursive: true });
  const marketingId = "marketing-test-001";
  fs.writeFileSync(path.join(workDir, "novel-marketing", `${marketingId}.json`), JSON.stringify({
    id: marketingId,
    source: { title: "The Hidden Family" },
    marketing: { selected: [{ rank: 1, title: "The Hidden Family", script: "This is a direct narration script long enough to be turned into speech without headings, production notes, or a call to action." }] }
  }), "utf8");

  let requestCount = 0;
  const service = createAudioLibraryService({
    root: "C:/test-project",
    workDir,
    readConfig: () => ({ elevenLabsApiKey: "secret-key", elevenLabsVoiceId: "voice-1", elevenLabsModelId: "model-1" }),
    fetchImpl: async () => {
      requestCount += 1;
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(2048, 1) };
    }
  });

  const first = await service.generateFromMarketing({ marketingId, rank: 1 });
  const second = await service.generateFromMarketing({ marketingId, rank: 1 });
  assert.equal(requestCount, 1);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(service.list().length, 1);
  assert.match(service.list()[0].script, /direct narration script/);
  assert.ok(fs.existsSync(service.resolveAudioPath(first.id)));
  assert.equal(JSON.stringify(service.list()).includes("secret-key"), false);
  assert.equal(JSON.stringify(service.list()).includes("voice-1"), false);
  const batch = service.prepareTaskBatch([first.id]);
  assert.equal(batch.count, 1);
  assert.ok(fs.existsSync(batch.audioDir));
  assert.equal(fs.readdirSync(batch.audioDir).filter((name) => name.endsWith(".mp3")).length, 1);

  const targetAudioDir = path.join(workDir, "operator-audio");
  const optimized = await service.generateFromOptimizedScript({
    sourceAudioId: first.id,
    sourceVideoId: "video-001",
    title: "The Hidden Family optimized",
    script: "The letter on my kitchen table proved my entire childhood was a lie. I opened it before sunrise, and the first sentence named the person who had been watching me for twenty years.",
    diagnosis: "Most viewers left during the setup before the conflict became clear.",
    evidenceSummary: "3-second retention 41%; largest loss at second 2.",
    rewriteMetadata: {
      problemLayer: "opening",
      rewriteScope: "opening_0_3s",
      targetSecondRange: "0-3s",
      estimatedSourceSentence: "This is a direct narration script.",
      rewriteGoal: "Move the conflict into the first sentence.",
      singleVariable: "opening_hook",
      preservedFacts: ["people", "relationships", "events", "ending"],
      changeLog: [{ before: "old opening", after: "new opening", reason: "weak hook", evidence: "retentionAt3" }]
    },
    planId: "plan-001",
    targetAudioDir
  });
  assert.equal(requestCount, 2);
  assert.equal(optimized.source.type, "ai-operation-rewrite");
  assert.ok(fs.existsSync(optimized.targetAudioPath));
  assert.match(service.get(optimized.id).script, /kitchen table/);
  assert.equal(service.get(optimized.id).metadata.problemLayer, "opening");
  assert.equal(service.get(optimized.id).metadata.singleVariable, "opening_hook");
  assert.equal(service.get(optimized.id).metadata.changeLog.length, 1);
  assert.match(service.get(first.id).script, /direct narration script/);
});

test("audio library uses the official ElevenLabs preview when a voice has one", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-preview-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  let ttsCalls = 0;
  const service = createAudioLibraryService({
    root: "C:/test-project",
    workDir,
    readConfig: () => ({ elevenLabsApiKey: "secret-key", elevenLabsVoiceId: "voice-1" }),
    fetchImpl: async (url) => {
      if (String(url).includes("/v1/voices/voice-rachel") && !String(url).includes("text-to-speech")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ voice_id: "voice-rachel", name: "Rachel", preview_url: "https://example.com/rachel.mp3" })
        };
      }
      ttsCalls += 1;
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(2048, 3) };
    }
  });
  const preview = await service.previewVoiceAudio("voice-rachel");
  assert.equal(preview.kind, "remote");
  assert.equal(preview.url, "https://example.com/rachel.mp3");
  assert.equal(ttsCalls, 0);
});

test("audio library maps ElevenLabs voice filters and keeps the multilingual v2 model", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-filters-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const service = createAudioLibraryService({
    root: "C:/test-project",
    workDir,
    readConfig: () => ({ elevenLabsApiKey: "secret-key", elevenLabsVoiceId: "", elevenLabsModelId: "should-not-use" }),
    fetchImpl: async (url) => {
      if (String(url).includes("/v1/voices")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            voices: [{
              voice_id: "voice-sarah",
              name: "Sarah",
              category: "premade",
              preview_url: "https://example.com/sarah.mp3",
              labels: { gender: "female", age: "young", language: "english" },
              verified_languages: [{ language: "en", locale: "en-US" }]
            }]
          })
        };
      }
      throw new Error(`unexpected url ${url}`);
    }
  });
  const listed = await service.listVoices();
  assert.equal(listed.modelId, "eleven_multilingual_v2");
  assert.equal(listed.voices[0].gender, "female");
  assert.equal(listed.voices[0].age, "young");
  assert.deepEqual(listed.voices[0].languages, ["en"]);
  assert.equal(listed.filters.genders[0].label, "女性");
  assert.equal(listed.filters.languages[0].value, "en");
});

test("script generation sends ElevenLabs speed and keeps default-speed cache", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-speed-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const bodies = [];
  const service = createAudioLibraryService({
    root: "C:/test-project",
    workDir,
    readConfig: () => ({ elevenLabsApiKey: "secret-key", elevenLabsVoiceId: "voice-1" }),
    fetchImpl: async (_url, options = {}) => {
      bodies.push(JSON.parse(options.body || "{}"));
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(2048, 1) };
    }
  });
  const script = "The letter on my kitchen table proved my entire childhood was a lie and I had less than one night to decide what to do next.";
  const first = await service.generateFromScript({ title: "Opening", script, speechSpeed: 1.1 });
  const again = await service.generateFromScript({ title: "Opening", script, speechSpeed: 1.1 });
  const faster = await service.generateFromScript({ title: "Opening", script, speechSpeed: 1.2 });
  assert.equal(first.cacheHit, false);
  assert.equal(again.cacheHit, true);
  assert.equal(faster.cacheHit, false);
  assert.equal(bodies[0].voice_settings.speed, 1.1);
  assert.equal(bodies[1].voice_settings.speed, 1.2);
  assert.equal(first.speechSpeed, 1.1);
});
