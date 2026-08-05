import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAnalysisChunks, createDeepSeekBrainService } from "./deepseek-brain.js";

const recipes = ["peripheral_hook", "tracking_hook", "position_memory", "schulte_complete"];
const stages = ["cold_start", "testing", "breakout", "scaling", "qualified", "recovery"];

test("saves a masked key and tests the DeepSeek connection", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepseek-brain-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const calls = [];
  const service = createDeepSeekBrainService({
    workDir,
    env: {},
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return jsonResponse({
        choices: [{ message: { content: "DEEPSEEK_CONNECTED" } }],
        usage: { prompt_tokens: 8, completion_tokens: 1 }
      });
    }
  });

  const saved = service.saveSettings({ apiKey: "sk-test-1234567890abcdef", reasoningMode: "enabled" });
  assert.equal(saved.configured, true);
  assert.match(saved.apiKeyHint, /cdef$/);
  assert.equal(Object.hasOwn(saved, "apiKey"), false);

  const result = await service.testConnection();
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-test-1234567890abcdef");
  assert.equal(calls[0].body.model, "deepseek-v4-flash");
  assert.deepEqual(calls[0].body.thinking, { type: "disabled" });
});

test("generates one JSON strategy request for an aggregated operation plan", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepseek-operation-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const calls = [];
  const fixture = makeStrategy();
  const service = createDeepSeekBrainService({
    workDir,
    env: { DEEPSEEK_API_KEY: "sk-env-1234567890abcdef" },
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return jsonResponse({ choices: [{ message: { content: JSON.stringify(fixture) } }], usage: { total_tokens: 500 } });
    }
  });

  const result = await service.generateOperationStrategy({
    planDate: "2026-08-02",
    objective: "traffic",
    accountCount: 20,
    stageSummary: [],
    baselineMixes: {},
    contentPerformance: [],
    publishTimePerformance: [],
    drafts: []
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "deepseek-v4-flash");
  assert.deepEqual(calls[0].thinking, { type: "enabled" });
  assert.deepEqual(calls[0].response_format, { type: "json_object" });
  assert.equal(result.strategy.allocationPlan.length, 6);
  assert.equal(result.strategy.scripts.length, 4);
});

test("full dataset chunks preserve every video and every retention point", () => {
  const dataset = makePrivateDataset(6, 30);
  const chunks = buildAnalysisChunks(dataset, 2_000);
  const videos = chunks.flatMap((chunk) => chunk.accounts.flatMap((account) => account.videos));
  assert.ok(chunks.length > 1);
  assert.deepEqual(videos.map((video) => video.videoId).sort(), dataset.accounts[0].videos.map((video) => video.videoId).sort());
  assert.equal(
    videos.reduce((sum, video) => sum + video.retentionCurve.length, 0),
    dataset.accounts[0].videos.reduce((sum, video) => sum + video.retentionCurve.length, 0)
  );
});

test("analyzes all full-data batches before synthesizing one operation strategy", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepseek-full-dataset-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const calls = [];
  const service = createDeepSeekBrainService({
    workDir,
    env: { DEEPSEEK_API_KEY: "sk-env-1234567890abcdef" },
    analysisChunkChars: 2_000,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      const isBatch = body.messages[1].content.includes("complete batch");
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify(isBatch ? {
          accountFindings: [{
            username: "demo",
            diagnosis: "Early retention drop.",
            retentionPatterns: ["Drop at second 3"],
            distributionPatterns: ["For You reach is high"],
            strongestVideoIds: ["video-1"],
            weakestVideoIds: ["video-2"],
            recommendedTests: ["Shorter hook"]
          }],
          crossVideoPatterns: ["Hooks need tightening"],
          risks: ["Do not confuse reach with retention"]
        } : makeStrategy()) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
      });
    }
  });
  const dataset = makePrivateDataset(6, 30);
  const result = await service.analyzeOperationDataset({
    planDate: "2026-08-04",
    objective: "traffic",
    accountCount: 1,
    fullPrivatePerformance: dataset
  });

  assert.equal(calls.length, result.analysisStats.batches + 1);
  assert.equal(result.analysisStats.videos, 6);
  assert.equal(result.analysisStats.retentionPoints, 180);
  assert.equal(result.evidenceReport.batches.length, result.analysisStats.batches);
  assert.equal(result.strategy.scripts.length, 4);
  assert.equal(result.usage.total_tokens, calls.length * 120);
});

function makePrivateDataset(videoCount, retentionPointCount) {
  return {
    windowDays: 10,
    accounts: [{
      username: "demo",
      videoCount,
      videos: Array.from({ length: videoCount }, (_, videoIndex) => ({
        videoId: `video-${videoIndex + 1}`,
        caption: `Video ${videoIndex + 1} ${"x".repeat(500)}`,
        duration: retentionPointCount,
        views: 1000 + videoIndex,
        fullWatchRate: 0.2,
        averageTimeWatched: 8,
        retentionCurve: Array.from({ length: retentionPointCount }, (_, second) => ({ second, percentage: 1 - second / retentionPointCount })),
        likeCurve: [{ second: 3, percentage: 0.1 }],
        impressionSources: [{ label: "For You", percentage: 0.9 }]
      }))
    }]
  };
}

function makeStrategy() {
  return {
    executiveSummary: "Scale the strongest cohorts.",
    accountDiagnosis: "Mixed account stages.",
    contentDirection: "Keep controlled template tests.",
    riskNotes: ["Do not overfit.", "Keep volume limits."],
    allocationPlan: stages.map((stage) => ({
      stage,
      mix: { peripheral_hook: 25, tracking_hook: 25, position_memory: 25, schulte_complete: 25 },
      rationale: "Balanced test."
    })),
    publishingPlan: stages.map((stage) => ({
      stage,
      startHour: 22,
      startMinute: 0,
      windowMinutes: 30,
      slotIntervalMinutes: 180,
      rationale: "Stable window."
    })),
    recipeTuning: recipes.map((recipeId) => ({
      recipeId,
      durationSeconds: 24,
      rotationSpeed: 2,
      trackingSeconds: 16,
      ballSpeed: 1.3,
      memorySteps: 6,
      peripheralTargets: 3,
      rationale: "Controlled variant."
    })),
    scripts: recipes.map((recipeId) => ({
      recipeId,
      targetStage: "all",
      headline: "Focus Test",
      mainTitle: "Can you finish it?",
      videoDesc: "Try this focus challenge.",
      rationale: "Short hook."
    }))
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}
