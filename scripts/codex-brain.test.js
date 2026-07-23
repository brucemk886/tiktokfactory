import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexBrainService } from "./codex-brain.js";

test("Codex connection test reports a successful local session", async () => {
  const calls = [];
  class FakeCodex {
    constructor(options) {
      calls.push(options || {});
    }

    startThread(options) {
      calls.push(options);
      return {
        run: async () => ({
          finalResponse: "CODEX_CONNECTED",
          usage: { input_tokens: 8, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 }
        })
      };
    }
  }

  const service = createCodexBrainService({ root: "C:/test-project", CodexClass: FakeCodex });
  assert.equal(service.getStatus().connected, false);

  const result = await service.testConnection();
  assert.equal(result.ok, true);
  assert.equal(result.connected, true);
  assert.equal(calls[1].sandboxMode, "read-only");
  assert.equal(calls[1].networkAccessEnabled, false);
  assert.equal(calls[1].approvalPolicy, "never");
});

test("Codex connection test rejects unexpected responses", async () => {
  class FakeCodex {
    startThread() {
      return { run: async () => ({ finalResponse: "unexpected", usage: null }) };
    }
  }

  const service = createCodexBrainService({ root: "C:/test-project", CodexClass: FakeCodex });
  await assert.rejects(service.testConnection(), /不符合预期/);
  assert.equal(service.getStatus().connected, false);
  assert.equal(service.getStatus().lastTest.ok, false);
});

test("novel marketing uses Sol, returns 20 hooks and saves five selected assets", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-marketing-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const calls = [];
  const marketing = makeMarketingFixture();

  class FakeCodex {
    startThread(options) {
      calls.push({ type: "thread", options });
      return {
        run: async (prompt, options) => {
          calls.push({ type: "run", prompt, options });
          return {
            finalResponse: JSON.stringify(marketing),
            usage: { input_tokens: 500, output_tokens: 1200 }
          };
        }
      };
    }
  }

  const sourceText = "A woman discovers that the husband she trusted has maintained a second family for years. She quietly gathers proof, protects her daughter, and prepares to confront him before he can empty their accounts.";
  const service = createCodexBrainService({ root: "C:/test-project", workDir, CodexClass: FakeCodex });
  const result = await service.generateNovelMarketing({ title: "The Second Family", sourceText });

  assert.equal(calls[0].options.model, "gpt-5.6-sol");
  assert.equal(calls[0].options.modelReasoningEffort, "medium");
  assert.equal(calls[0].options.networkAccessEnabled, false);
  assert.equal(calls[0].options.sandboxMode, "read-only");
  assert.equal(calls[1].options.outputSchema.properties.hooks.minItems, 20);
  assert.match(calls[1].prompt, /<story_source>/);
  assert.equal(result.marketing.hooks.length, 20);
  assert.equal(result.marketing.selected.length, 5);
  assert.equal(result.source.sourceChars, sourceText.length);
  assert.equal(typeof result.durationMs, "number");

  const savedPath = path.join(workDir, "novel-marketing", `${result.id}.json`);
  const saved = JSON.parse(fs.readFileSync(savedPath, "utf8"));
  assert.equal(saved.marketing.selected.length, 5);
  assert.equal(saved.source.sourceChars, sourceText.length);
  assert.equal(Object.hasOwn(saved.source, "sourceText"), false);
  assert.equal(fs.readFileSync(savedPath, "utf8").includes(sourceText), false);
});

test("novel marketing rejects source text that is too short", async () => {
  const service = createCodexBrainService({ root: "C:/test-project", CodexClass: class {} });
  await assert.rejects(
    service.generateNovelMarketing({ sourceText: "too short" }),
    (error) => error.statusCode === 400 && /至少输入80个字符/.test(error.message)
  );
});

test("novel marketing turns a disconnected stream into a safe retry error", async () => {
  class FakeCodex {
    startThread() {
      return { run: async () => { throw new Error("stream disconnected before completion"); } };
    }
  }

  const service = createCodexBrainService({ root: "C:/test-project", CodexClass: FakeCodex });
  await assert.rejects(
    service.generateNovelMarketing({ sourceText: "A sufficiently long fictional story source that exceeds eighty characters and can safely exercise the disconnected-stream branch without calling a real model." }),
    (error) => error.statusCode === 503 && /安全重试/.test(error.message)
  );
  assert.equal(service.getStatus().running, false);
  assert.equal(service.getStatus().lastMarketingRun.ok, false);
});

test("AI creation uses medium reasoning and returns directly usable content", async () => {
  const calls = [];
  class FakeCodex {
    startThread(options) {
      calls.push(options);
      return { run: async (prompt) => { calls.push(prompt); return { finalResponse: "A ready-to-use narration.", usage: { output_tokens: 8 } }; } };
    }
  }
  const service = createCodexBrainService({ root: "C:/test-project", CodexClass: FakeCodex });
  const result = await service.generateCreation({ mode: "narration", language: "English", prompt: "Rewrite this psychology test as a voiceover." });
  assert.equal(calls[0].modelReasoningEffort, "medium");
  assert.equal(calls[0].sandboxMode, "read-only");
  assert.match(calls[1], /ElevenLabs/);
  assert.equal(result.content, "A ready-to-use narration.");
});

function makeMarketingFixture() {
  return {
    packageTitle: "The Second Family Launch Pack",
    positioning: "Betrayal story built around a hidden family and financial danger.",
    audience: "Women who enjoy relationship betrayal and revenge stories.",
    coreConflict: "A wife must expose her husband's second life before he steals their savings.",
    hooks: Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      angle: `Angle ${index + 1}`,
      hook: `Hook ${index + 1}: She found proof of the life he hid from her.`,
      emotion: "betrayal",
      curiosityGap: "What she did with the proof"
    })),
    selected: Array.from({ length: 5 }, (_, index) => ({
      rank: index + 1,
      sourceHookId: index + 1,
      angle: `Angle ${index + 1}`,
      title: `The Secret He Thought She Would Never Find ${index + 1}`,
      script: "I found the first receipt in the pocket of the coat he never let me touch. It led me to a storage unit filled with photographs of a family I had never seen, and every envelope carried my husband's handwriting. I copied the documents before he came home and called the woman named on the lease. She did not ask who I was. She only said that my husband had told her I died years ago. Then I checked our savings account and saw a transfer scheduled for Monday morning. By the time he sat down for dinner, I had less than forty-eight hours to decide whether to confront him or let the money move so someone else could trace where it went.",
      hashtags: ["#storytime", "#betrayal", "#redditstories"],
      whyItWins: "It opens with a concrete discovery and promises a consequential reveal."
    }))
  };
}
