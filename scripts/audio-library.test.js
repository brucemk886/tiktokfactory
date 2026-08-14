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
