import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_EVIDENCE_POLICY,
  EVALUATION_WINDOWS,
  aggregatePatternEvaluations,
  buildPatternKey,
  evaluateExperimentWindow
} from "./novel-learning-loop.js";

const STATE_VERSION = 1;

export function createNovelLearningService({ statePath, now = () => Date.now(), policyProvider = null }) {
  if (!statePath) throw new Error("novel learning statePath is required");

  function evidencePolicy() {
    const policy = typeof policyProvider === "function" ? policyProvider() : null;
    const evaluation = policy?.evaluation && typeof policy.evaluation === "object" ? policy.evaluation : policy || {};
    return {
      minTests: Number(evaluation.confidenceMinTests ?? evaluation.minTests) || DEFAULT_EVIDENCE_POLICY.minTests,
      minViews: Number.isFinite(Number(evaluation.minViews)) ? Number(evaluation.minViews) : DEFAULT_EVIDENCE_POLICY.minViews,
      minConfidence: Number.isFinite(Number(evaluation.minConfidence)) ? Number(evaluation.minConfidence) : DEFAULT_EVIDENCE_POLICY.minConfidence
    };
  }

  function getState() {
    return normalizeState(readJson(statePath, null));
  }

  function registerOptimizations({ planId = "", optimizedContent = [], createdAt = now() } = {}) {
    const state = getState();
    const added = [];
    for (const item of Array.isArray(optimizedContent) ? optimizedContent : []) {
      if (item?.status !== "completed" || !item?.sourceAudioId || !item?.audio?.id) continue;
      const id = stableId(`${planId}:${item.sourceAudioId}:${item.audio.id}`);
      if (state.experiments.some((entry) => entry.id === id)) continue;
      const parent = [...state.experiments].reverse().find((entry) => entry.generatedAudioId === item.sourceAudioId) || null;
      const rewriteMetadata = {
        problemLayer: String(item.problemLayer || ""),
        rewriteScope: String(item.rewriteScope || ""),
        rewriteGoal: String(item.rewriteGoal || ""),
        singleVariable: String(item.singleVariable || "")
      };
      const experiment = {
        id,
        planId: String(planId || ""),
        parentExperimentId: parent?.id || "",
        sourceAudioId: String(item.sourceAudioId),
        generatedAudioId: String(item.audio.id),
        sourceVideoId: String(item.sourceVideoId || ""),
        title: String(item.title || ""),
        rewriteMetadata,
        patternKey: buildPatternKey(rewriteMetadata),
        status: "awaiting_publish",
        evaluations: [],
        createdAt: Number(createdAt) || now(),
        updatedAt: now()
      };
      state.experiments.push(experiment);
      added.push(experiment);
    }
    if (added.length) saveState(state);
    return { addedCount: added.length, experiments: added };
  }

  function refreshFromAnalysis({ analysis = {}, evaluatedAt = now() } = {}) {
    const state = getState();
    const policy = evidencePolicy();
    const scripts = (analysis?.novels || []).flatMap((novel) => Array.isArray(novel?.scripts) ? novel.scripts : []);
    const accountBaselines = analysis?.accountBaselines && typeof analysis.accountBaselines === "object"
      ? analysis.accountBaselines
      : null;
    let evaluationCount = 0;
    for (const experiment of state.experiments) {
      const candidate = scripts.find((script) => String(script?.audioId || script?.audio?.id || "") === experiment.generatedAudioId);
      if (!candidate) continue;
      const baseline = scripts.find((script) =>
        String(script?.audioId || script?.audio?.id || "") === experiment.sourceAudioId ||
        (experiment.sourceVideoId && String(script?.videoId || script?.id || "") === experiment.sourceVideoId)
      );
      const publishedAt = Number(candidate?.performance?.publishedAt || candidate?.publishedAt || earliestPublishedAt(candidate) || experiment.createdAt) || experiment.createdAt;
      const ageMs = Math.max(0, Number(evaluatedAt) - publishedAt);
      for (const window of EVALUATION_WINDOWS) {
        if (ageMs < window.minAgeMs || experiment.evaluations.some((item) => item.windowId === window.id)) continue;
        experiment.evaluations.push(evaluateExperimentWindow({
          experiment,
          windowId: window.id,
          candidate,
          baseline: baseline || {},
          accountBaselines,
          evaluatedAt,
          minViews: policy.minViews
        }));
        evaluationCount += 1;
      }
      experiment.status = experiment.evaluations.some((item) => item.windowId === "7d") ? "evaluated" : "monitoring";
      experiment.updatedAt = Number(evaluatedAt) || now();
    }
    state.patterns = aggregatePatternEvaluations(state.experiments, policy);
    if (evaluationCount || state.patterns.length) saveState(state);
    return { evaluationCount, patternCount: state.patterns.length };
  }

  function earliestPublishedAt(script) {
    const times = (Array.isArray(script?.videos) ? script.videos : [])
      .map((video) => Number(video?.publishedAt) || 0)
      .filter((value) => value > 0)
      .map((value) => (value < 1e12 ? value * 1000 : value));
    return times.length ? Math.min(...times) : 0;
  }

  function getStrategyContext() {
    const state = getState();
    const compact = (pattern) => ({
      key: pattern.key,
      status: pattern.status,
      confidence: pattern.confidence,
      score: pattern.score,
      evaluationCount: pattern.evaluationCount,
      experimentCount: pattern.experimentCount ?? 0,
      insufficientExperiments: pattern.insufficientExperiments ?? 0
    });
    return {
      promotedPatterns: state.patterns.filter((item) => item.status === "promoted").map(compact),
      demotedPatterns: state.patterns.filter((item) => item.status === "demoted").map(compact),
      testingPatterns: state.patterns.filter((item) => item.status === "testing").map(compact),
      activeExperiments: state.experiments.filter((item) => item.status !== "evaluated").slice(-100).map((item) => ({
        id: item.id,
        parentExperimentId: item.parentExperimentId,
        sourceAudioId: item.sourceAudioId,
        generatedAudioId: item.generatedAudioId,
        patternKey: item.patternKey,
        status: item.status,
        evaluationWindows: item.evaluations.map((entry) => entry.windowId)
      }))
    };
  }

  function saveState(state) {
    const normalized = { ...normalizeState(state), updatedAt: now() };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, statePath);
  }

  return { getState, registerOptimizations, refreshFromAnalysis, getStrategyContext };
}

function normalizeState(value) {
  return {
    version: STATE_VERSION,
    experiments: Array.isArray(value?.experiments) ? value.experiments : [],
    patterns: Array.isArray(value?.patterns) ? value.patterns : [],
    updatedAt: Number(value?.updatedAt) || 0
  };
}

function stableId(value) {
  return `exp-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
