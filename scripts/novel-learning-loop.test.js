import assert from "node:assert/strict";
import test from "node:test";
import { aggregatePatternEvaluations, evaluateExperimentWindow } from "./novel-learning-loop.js";

test("experiment evaluation compares retention and watch quality with its baseline", () => {
  const evaluation = evaluateExperimentWindow({
    experiment: { id: "exp-1" },
    windowId: "24h",
    evaluatedAt: 100,
    candidate: { views: 2000, retentionAt3: 0.72, fullWatchRate: 0.41, videoDuration: 60, averageTimeWatched: 31 },
    baseline: { views: 1000, retentionAt3: 0.55, fullWatchRate: 0.3, videoDuration: 60, averageTimeWatched: 22 }
  });

  assert.equal(evaluation.windowId, "24h");
  assert.equal(evaluation.decision, "win");
  assert.ok(evaluation.score >= 0.08);
  assert.ok(evaluation.confidence > 0.5);
});

test("patterns stay testing until enough evidence then promote or demote", () => {
  const positive = ["24h", "72h", "7d"].map((windowId, index) => ({
    windowId,
    score: 0.2,
    confidence: 0.8,
    decision: "win",
    evaluatedAt: index + 1
  }));
  const negative = positive.map((item) => ({ ...item, score: -0.2, decision: "loss" }));
  const patterns = aggregatePatternEvaluations([
    { patternKey: "hook:opening:conflict:hook", evaluations: positive },
    { patternKey: "middle:paragraph:pacing:sentence", evaluations: negative },
    { patternKey: "ending:ending:payoff:ending", evaluations: positive.slice(0, 2) }
  ]);

  assert.equal(patterns.find((item) => item.key.startsWith("hook"))?.status, "promoted");
  assert.equal(patterns.find((item) => item.key.startsWith("middle"))?.status, "demoted");
  assert.equal(patterns.find((item) => item.key.startsWith("ending"))?.status, "testing");
});
