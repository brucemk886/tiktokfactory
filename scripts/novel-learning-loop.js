export const EVALUATION_WINDOWS = Object.freeze([
  Object.freeze({ id: "24h", minAgeMs: 24 * 60 * 60 * 1000 }),
  Object.freeze({ id: "72h", minAgeMs: 72 * 60 * 60 * 1000 }),
  Object.freeze({ id: "7d", minAgeMs: 7 * 24 * 60 * 60 * 1000 })
]);

export function evaluateExperimentWindow({ experiment, candidate, baseline, windowId, evaluatedAt = Date.now() }) {
  const candidateMetrics = normalizeMetrics(candidate);
  const baselineMetrics = normalizeMetrics(baseline);
  const dimensions = [
    scoreDimension("views", candidateMetrics.views, baselineMetrics.views, 0.25, true),
    scoreDimension("retentionAt3", candidateMetrics.retentionAt3, baselineMetrics.retentionAt3, 0.35),
    scoreDimension("fullWatchRate", candidateMetrics.fullWatchRate, baselineMetrics.fullWatchRate, 0.25),
    scoreDimension("averageWatchRatio", candidateMetrics.averageWatchRatio, baselineMetrics.averageWatchRatio, 0.15)
  ].filter(Boolean);
  const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0) || 1;
  const score = dimensions.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
  const viewConfidence = Math.min(1, Math.log10(Math.max(10, candidateMetrics.views + 1)) / 4);
  const coverageConfidence = dimensions.length / 4;
  const confidence = round(Math.max(0.05, viewConfidence * 0.65 + coverageConfidence * 0.35), 3);
  return {
    id: `${experiment.id}:${windowId}`,
    experimentId: experiment.id,
    windowId,
    evaluatedAt,
    score: round(score, 4),
    confidence,
    decision: score >= 0.08 ? "win" : score <= -0.08 ? "loss" : "inconclusive",
    candidateMetrics,
    baselineMetrics,
    dimensions
  };
}

export function buildPatternKey(metadata = {}) {
  const parts = [
    metadata.problemLayer,
    metadata.rewriteScope,
    metadata.rewriteGoal,
    metadata.singleVariable
  ].map((value) => String(value || "unknown").trim().toLowerCase().replace(/\s+/g, "_"));
  return parts.join(":");
}

export function aggregatePatternEvaluations(experiments = []) {
  const groups = new Map();
  for (const experiment of experiments) {
    const key = String(experiment.patternKey || buildPatternKey(experiment.rewriteMetadata));
    if (!groups.has(key)) groups.set(key, []);
    for (const evaluation of experiment.evaluations || []) groups.get(key).push(evaluation);
  }
  return Array.from(groups, ([key, evaluations]) => {
    const weighted = evaluations.reduce((sum, item) => sum + Number(item.score || 0) * Number(item.confidence || 0), 0);
    const confidenceTotal = evaluations.reduce((sum, item) => sum + Number(item.confidence || 0), 0);
    const score = confidenceTotal ? weighted / confidenceTotal : 0;
    const confidence = evaluations.length
      ? evaluations.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / evaluations.length
      : 0;
    const wins = evaluations.filter((item) => item.decision === "win").length;
    const losses = evaluations.filter((item) => item.decision === "loss").length;
    const enoughEvidence = evaluations.length >= 3 && confidence >= 0.6;
    return {
      key,
      evaluationCount: evaluations.length,
      wins,
      losses,
      score: round(score, 4),
      confidence: round(confidence, 3),
      status: enoughEvidence && score >= 0.08
        ? "promoted"
        : enoughEvidence && score <= -0.08
          ? "demoted"
          : "testing",
      updatedAt: Math.max(0, ...evaluations.map((item) => Number(item.evaluatedAt) || 0))
    };
  }).sort((left, right) => right.score - left.score);
}

export function normalizeMetrics(value = {}) {
  const duration = number(value.videoDuration ?? value.duration);
  const averageTime = number(value.averageTimeWatched ?? value.averageWatchTime);
  return {
    views: number(value.views ?? value.videoViews),
    retentionAt3: rate(value.retentionAt3 ?? value.retention3s),
    fullWatchRate: rate(value.fullWatchRate ?? value.fullVideoWatchedRate),
    averageWatchRatio: duration > 0 ? Math.min(1, averageTime / duration) : rate(value.averageWatchRatio)
  };
}

function scoreDimension(name, candidate, baseline, weight, logarithmic = false) {
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline) || baseline <= 0) return null;
  const raw = logarithmic
    ? Math.log1p(candidate) / Math.log1p(baseline) - 1
    : candidate / baseline - 1;
  return { name, weight, score: round(Math.max(-1, Math.min(1, raw)), 4) };
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function rate(value) {
  const parsed = number(value);
  return parsed > 1 ? Math.min(1, parsed / 100) : parsed;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}
