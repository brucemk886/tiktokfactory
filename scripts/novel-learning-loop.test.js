import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregatePatternEvaluations,
  buildAccountBaselines,
  evaluateExperimentWindow,
  normalizeAgainstAccounts
} from "./novel-learning-loop.js";

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
  assert.equal(evaluation.sufficient, true);
  assert.ok(evaluation.score >= 0.08);
  assert.ok(evaluation.confidence > 0.5);
});

test("a window below the view floor is recorded but does not count as evidence", () => {
  const evaluation = evaluateExperimentWindow({
    experiment: { id: "exp-low" },
    windowId: "7d",
    candidate: { views: 120, retentionAt3: 0.9, fullWatchRate: 0.6, videoDuration: 60, averageTimeWatched: 50 },
    baseline: { views: 100, retentionAt3: 0.4, fullWatchRate: 0.2, videoDuration: 60, averageTimeWatched: 20 },
    minViews: 1000
  });
  assert.equal(evaluation.sufficient, false);
  assert.equal(evaluation.decision, "insufficient");
  const patterns = aggregatePatternEvaluations([
    { patternKey: "hook:opening:conflict:hook", evaluations: [evaluation, evaluation, evaluation] }
  ]);
  assert.equal(patterns[0].status, "testing");
  assert.equal(patterns[0].experimentCount, 0);
  assert.equal(patterns[0].insufficientExperiments, 1);
});

test("one experiment with three windows is one vote, not three", () => {
  const windows = ["24h", "72h", "7d"].map((windowId, index) => ({
    windowId,
    score: 0.2,
    confidence: 0.8,
    decision: "win",
    sufficient: true,
    evaluatedAt: index + 1
  }));
  const single = aggregatePatternEvaluations([{ patternKey: "hook:opening:conflict:hook", evaluations: windows }]);
  assert.equal(single[0].status, "testing");
  assert.equal(single[0].experimentCount, 1);
  assert.equal(single[0].evaluationCount, 3);

  const three = aggregatePatternEvaluations([
    { id: "a", patternKey: "hook:opening:conflict:hook", evaluations: windows },
    { id: "b", patternKey: "hook:opening:conflict:hook", evaluations: windows.slice(0, 1) },
    { id: "c", patternKey: "hook:opening:conflict:hook", evaluations: windows.slice(0, 2) }
  ]);
  assert.equal(three[0].status, "promoted");
  assert.equal(three[0].experimentCount, 3);
  assert.equal(three[0].wins, 3);

  const negative = windows.map((item) => ({ ...item, score: -0.2, decision: "loss" }));
  const demoted = aggregatePatternEvaluations([
    { id: "a", patternKey: "middle:paragraph:pacing:sentence", evaluations: negative },
    { id: "b", patternKey: "middle:paragraph:pacing:sentence", evaluations: negative },
    { id: "c", patternKey: "middle:paragraph:pacing:sentence", evaluations: negative }
  ]);
  assert.equal(demoted[0].status, "demoted");

  // The strategy policy can raise the bar.
  const strict = aggregatePatternEvaluations([
    { id: "a", patternKey: "k", evaluations: windows },
    { id: "b", patternKey: "k", evaluations: windows },
    { id: "c", patternKey: "k", evaluations: windows }
  ], { minTests: 5 });
  assert.equal(strict[0].status, "testing");
});

test("the latest mature window is the experiment's vote", () => {
  const evaluations = [
    { windowId: "24h", score: 0.5, confidence: 0.8, decision: "win", sufficient: true, evaluatedAt: 1 },
    { windowId: "7d", score: -0.5, confidence: 0.8, decision: "loss", sufficient: true, evaluatedAt: 3 },
    { windowId: "72h", score: 0.1, confidence: 0.8, decision: "win", sufficient: true, evaluatedAt: 2 }
  ];
  const [pattern] = aggregatePatternEvaluations([{ patternKey: "k", evaluations }], { minTests: 1 });
  assert.equal(pattern.losses, 1);
  assert.equal(pattern.wins, 0);
  assert.equal(pattern.status, "demoted");
});

test("account baselines are per-account medians and need enough samples", () => {
  const baselines = buildAccountBaselines([
    { username: "Big", views: 10_000, retentionAt3: 0.6, fullWatchRate: 0.3, averageTimeWatched: 30, duration: 60 },
    { username: "big", views: 30_000, retentionAt3: 0.7, fullWatchRate: 0.4, averageTimeWatched: 36, duration: 60 },
    { username: "big", views: 20_000, retentionAt3: 0.65, fullWatchRate: 0.35, averageTimeWatched: 33, duration: 60 },
    { username: "small", views: 100, retentionAt3: 0.5 },
    { username: "small", views: 300, retentionAt3: 0.5 }
  ], { minSamples: 3 });
  assert.deepEqual(Object.keys(baselines), ["big"]);
  assert.equal(baselines.big.sampleCount, 3);
  assert.equal(baselines.big.views, 20_000);
  assert.equal(baselines.big.retentionAt3, 0.65);
  assert.equal(Math.round(baselines.big.averageWatchRatio * 100) / 100, 0.55);
});

test("a rewrite on a big account is not a win just because the account is big", () => {
  const accountBaselines = {
    big: { sampleCount: 10, views: 20_000, retentionAt3: 0.65, fullWatchRate: 0.35, averageWatchRatio: 0.55 },
    small: { sampleCount: 10, views: 500, retentionAt3: 0.5, fullWatchRate: 0.25, averageWatchRatio: 0.45 }
  };
  // Candidate rewrite posted on the big account: numbers are high in absolute
  // terms but exactly the account's normal level.
  const candidate = { videos: [{ username: "big", views: 20_000, retentionAt3: 0.65, fullWatchRate: 0.35, averageTimeWatched: 33, duration: 60 }] };
  // Original posted on the small account, doing better than that account usually does.
  const baseline = { videos: [{ username: "small", views: 1_000, retentionAt3: 0.6, fullWatchRate: 0.3, averageTimeWatched: 30, duration: 60 }] };

  const raw = evaluateExperimentWindow({ experiment: { id: "raw" }, windowId: "7d", candidate, baseline, minViews: 0 });
  assert.equal(raw.decision, "win", "without normalization the big account looks like a win");
  assert.equal(raw.normalized, false);

  const normalized = evaluateExperimentWindow({ experiment: { id: "norm" }, windowId: "7d", candidate, baseline, accountBaselines, minViews: 0 });
  assert.equal(normalized.normalized, true);
  assert.equal(normalized.decision, "loss");
  assert.ok(normalized.score < 0);
});

test("normalization falls back to raw numbers when no account has a baseline", () => {
  const subject = { videos: [{ username: "nobody", views: 400, retentionAt3: 0.5, fullWatchRate: 0.2, averageTimeWatched: 30, duration: 60 }] };
  const result = normalizeAgainstAccounts(subject, { other: { views: 100, retentionAt3: 0.5, fullWatchRate: 0.2, averageWatchRatio: 0.5 } });
  assert.equal(result.normalized, false);
  assert.equal(result.rawViews, 400);
  assert.equal(result.metrics.views, 400);
  assert.equal(result.metrics.retentionAt3, 0.5);
  // Aggregate performance objects still work and read totalViews.
  const fromPerformance = normalizeAgainstAccounts({ performance: { totalViews: 1200, retentionAt3: 0.4 } }, null);
  assert.equal(fromPerformance.rawViews, 1200);
});
