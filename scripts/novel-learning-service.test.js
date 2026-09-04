import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNovelLearningService } from "./novel-learning-service.js";

function setup(context, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-learning-"));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const clock = { value: Date.UTC(2026, 7, 1) };
  const service = createNovelLearningService({ statePath: path.join(dir, "state.json"), now: () => clock.value, ...options });
  return { service, clock };
}

function optimization(index) {
  return {
    status: "completed",
    sourceAudioId: `audio-original-${index}`,
    sourceVideoId: `video-original-${index}`,
    audio: { id: `audio-candidate-${index}` },
    problemLayer: "hook",
    rewriteScope: "opening",
    rewriteGoal: "move conflict forward",
    singleVariable: "first sentence"
  };
}

function scriptPair(index, publishedAt, { views = 2200 } = {}) {
  return [
    { audioId: `audio-original-${index}`, videos: [{ username: "acct", publishedAt, views: 1000, retentionAt3: 0.5, fullWatchRate: 0.3, averageTimeWatched: 20, duration: 60 }] },
    { audioId: `audio-candidate-${index}`, videos: [{ username: "acct", publishedAt, views, retentionAt3: 0.72, fullWatchRate: 0.45, averageTimeWatched: 34, duration: 60 }] }
  ];
}

test("learning service persists version chains and evaluates 24h 72h and 7d once", (context) => {
  const { service, clock } = setup(context);
  const registered = service.registerOptimizations({ planId: "plan-1", createdAt: clock.value, optimizedContent: [optimization(1)] });
  assert.equal(registered.addedCount, 1);
  assert.equal(registered.experiments[0].parentExperimentId, "");

  const publishedAt = clock.value;
  clock.value += 8 * 24 * 60 * 60 * 1000;
  const analysis = { novels: [{ scripts: scriptPair(1, publishedAt) }] };
  assert.equal(service.refreshFromAnalysis({ analysis, evaluatedAt: clock.value }).evaluationCount, 3);
  assert.equal(service.refreshFromAnalysis({ analysis, evaluatedAt: clock.value }).evaluationCount, 0);

  const state = service.getState();
  assert.deepEqual(state.experiments[0].evaluations.map((item) => item.windowId), ["24h", "72h", "7d"]);
  assert.equal(state.experiments[0].status, "evaluated");
  // One experiment is not enough to learn a rule from.
  assert.equal(service.getStrategyContext().promotedPatterns.length, 0);
  assert.equal(service.getStrategyContext().testingPatterns[0].experimentCount, 1);
});

test("a pattern is promoted only after three independent experiments clear the view floor", (context) => {
  const { service, clock } = setup(context, { policyProvider: () => ({ evaluation: { confidenceMinTests: 3, minViews: 1000 } }) });
  service.registerOptimizations({ planId: "plan-1", createdAt: clock.value, optimizedContent: [1, 2, 3].map(optimization) });
  const publishedAt = clock.value;
  clock.value += 8 * 24 * 60 * 60 * 1000;

  // Third candidate only got 300 views: recorded, but not evidence.
  const analysis = { novels: [{ scripts: [...scriptPair(1, publishedAt), ...scriptPair(2, publishedAt), ...scriptPair(3, publishedAt, { views: 300 })] }] };
  service.refreshFromAnalysis({ analysis, evaluatedAt: clock.value });
  let context1 = service.getStrategyContext();
  assert.equal(context1.promotedPatterns.length, 0);
  assert.equal(context1.testingPatterns[0].experimentCount, 2);
  assert.equal(context1.testingPatterns[0].insufficientExperiments, 1);

  // A fourth experiment with real traffic tips it over.
  service.registerOptimizations({ planId: "plan-2", createdAt: publishedAt, optimizedContent: [optimization(4)] });
  const more = { novels: [{ scripts: [...analysis.novels[0].scripts, ...scriptPair(4, publishedAt)] }] };
  service.refreshFromAnalysis({ analysis: more, evaluatedAt: clock.value });
  context1 = service.getStrategyContext();
  assert.equal(context1.promotedPatterns.length, 1);
  assert.equal(context1.promotedPatterns[0].experimentCount, 3);
});

test("account baselines from the analysis are applied to the evaluation", (context) => {
  const { service, clock } = setup(context, { policyProvider: () => ({ evaluation: { minViews: 0 } }) });
  service.registerOptimizations({ planId: "plan-1", createdAt: clock.value, optimizedContent: [optimization(1)] });
  const publishedAt = clock.value;
  clock.value += 2 * 24 * 60 * 60 * 1000;
  const analysis = {
    accountBaselines: {
      big: { sampleCount: 10, views: 20_000, retentionAt3: 0.65, fullWatchRate: 0.35, averageWatchRatio: 0.55 },
      small: { sampleCount: 10, views: 500, retentionAt3: 0.5, fullWatchRate: 0.25, averageWatchRatio: 0.45 }
    },
    novels: [{ scripts: [
      { audioId: "audio-original-1", videos: [{ username: "small", publishedAt, views: 1000, retentionAt3: 0.6, fullWatchRate: 0.3, averageTimeWatched: 30, duration: 60 }] },
      { audioId: "audio-candidate-1", videos: [{ username: "big", publishedAt, views: 20_000, retentionAt3: 0.65, fullWatchRate: 0.35, averageTimeWatched: 33, duration: 60 }] }
    ] }]
  };
  service.refreshFromAnalysis({ analysis, evaluatedAt: clock.value });
  const [experiment] = service.getState().experiments;
  assert.equal(experiment.evaluations[0].normalized, true);
  assert.equal(experiment.evaluations[0].decision, "loss");
});
