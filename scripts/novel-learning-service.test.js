import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNovelLearningService } from "./novel-learning-service.js";

test("learning service persists version chains and evaluates 24h 72h and 7d once", (context) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-learning-"));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = Date.UTC(2026, 7, 1);
  const service = createNovelLearningService({ statePath: path.join(dir, "state.json"), now: () => clock });

  const registered = service.registerOptimizations({
    planId: "plan-1",
    createdAt: clock,
    optimizedContent: [{
      status: "completed",
      sourceAudioId: "audio-original",
      sourceVideoId: "video-original",
      audio: { id: "audio-candidate" },
      problemLayer: "hook",
      rewriteScope: "opening",
      rewriteGoal: "move conflict forward",
      singleVariable: "first sentence"
    }]
  });
  assert.equal(registered.addedCount, 1);
  assert.equal(registered.experiments[0].parentExperimentId, "");

  clock += 8 * 24 * 60 * 60 * 1000;
  const analysis = {
    novels: [{ scripts: [
      { audioId: "audio-original", performance: { views: 1000, retentionAt3: 0.5, fullWatchRate: 0.3, videoDuration: 60, averageTimeWatched: 20 } },
      { audioId: "audio-candidate", publishedAt: Date.UTC(2026, 7, 1), performance: { publishedAt: Date.UTC(2026, 7, 1), views: 2200, retentionAt3: 0.72, fullWatchRate: 0.45, videoDuration: 60, averageTimeWatched: 34 } }
    ] }]
  };
  assert.equal(service.refreshFromAnalysis({ analysis, evaluatedAt: clock }).evaluationCount, 3);
  assert.equal(service.refreshFromAnalysis({ analysis, evaluatedAt: clock }).evaluationCount, 0);

  const state = service.getState();
  assert.deepEqual(state.experiments[0].evaluations.map((item) => item.windowId), ["24h", "72h", "7d"]);
  assert.equal(state.experiments[0].status, "evaluated");
  assert.equal(service.getStrategyContext().promotedPatterns.length, 1);
});
