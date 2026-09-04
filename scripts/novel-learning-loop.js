export const EVALUATION_WINDOWS = Object.freeze([
  Object.freeze({ id: "24h", minAgeMs: 24 * 60 * 60 * 1000 }),
  Object.freeze({ id: "72h", minAgeMs: 72 * 60 * 60 * 1000 }),
  Object.freeze({ id: "7d", minAgeMs: 7 * 24 * 60 * 60 * 1000 })
]);

// One experiment used to be enough to promote a rewrite pattern: its three
// windows (24h/72h/7d) counted as three pieces of evidence, and a hundred
// views already cleared the confidence bar. Evidence is now counted per
// experiment, a minimum view count is required before a window counts, and
// metrics are normalized against the account that posted the video so a
// 50k-follower account is not "proof" that a rewrite works.
export const DEFAULT_EVIDENCE_POLICY = Object.freeze({
  minTests: 3,
  minViews: 1000,
  minConfidence: 0.6,
  accountMinSamples: 3
});

const WINDOW_RANK = Object.freeze({ "24h": 1, "72h": 2, "7d": 3 });

export function evaluateExperimentWindow({
  experiment,
  candidate,
  baseline,
  accountBaselines = null,
  windowId,
  evaluatedAt = Date.now(),
  minViews = DEFAULT_EVIDENCE_POLICY.minViews
}) {
  const candidateSide = normalizeAgainstAccounts(candidate, accountBaselines);
  const baselineSide = normalizeAgainstAccounts(baseline, accountBaselines);
  const candidateMetrics = candidateSide.metrics;
  const baselineMetrics = baselineSide.metrics;
  const dimensions = [
    scoreDimension("views", candidateMetrics.views, baselineMetrics.views, 0.25, !candidateSide.normalized),
    scoreDimension("retentionAt3", candidateMetrics.retentionAt3, baselineMetrics.retentionAt3, 0.35),
    scoreDimension("fullWatchRate", candidateMetrics.fullWatchRate, baselineMetrics.fullWatchRate, 0.25),
    scoreDimension("averageWatchRatio", candidateMetrics.averageWatchRatio, baselineMetrics.averageWatchRatio, 0.15)
  ].filter(Boolean);
  const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0) || 1;
  const score = dimensions.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
  const rawViews = candidateSide.rawViews;
  const viewConfidence = Math.min(1, Math.log10(Math.max(10, rawViews + 1)) / 4);
  const coverageConfidence = dimensions.length / 4;
  const sufficient = rawViews >= Math.max(0, Number(minViews) || 0) && dimensions.length >= 2;
  const confidence = round(Math.max(0.05, viewConfidence * 0.65 + coverageConfidence * 0.35), 3);
  return {
    id: `${experiment.id}:${windowId}`,
    experimentId: experiment.id,
    windowId,
    evaluatedAt,
    score: round(score, 4),
    confidence,
    sufficient,
    rawViews,
    normalized: candidateSide.normalized && baselineSide.normalized,
    decision: !sufficient ? "insufficient" : score >= 0.08 ? "win" : score <= -0.08 ? "loss" : "inconclusive",
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

// One vote per experiment: its most mature sufficient window. Patterns need
// `minTests` distinct experiments before they can be promoted or demoted.
export function aggregatePatternEvaluations(experiments = [], policy = {}) {
  const minTests = Math.max(1, Math.floor(Number(policy.minTests) || DEFAULT_EVIDENCE_POLICY.minTests));
  const minConfidence = Number.isFinite(Number(policy.minConfidence)) ? Number(policy.minConfidence) : DEFAULT_EVIDENCE_POLICY.minConfidence;
  const groups = new Map();
  for (const experiment of experiments) {
    const key = String(experiment.patternKey || buildPatternKey(experiment.rewriteMetadata));
    if (!groups.has(key)) groups.set(key, { votes: [], evaluationCount: 0, insufficient: 0 });
    const group = groups.get(key);
    const evaluations = Array.isArray(experiment.evaluations) ? experiment.evaluations : [];
    group.evaluationCount += evaluations.length;
    const vote = latestSufficientEvaluation(evaluations);
    if (vote) group.votes.push(vote);
    else if (evaluations.length) group.insufficient += 1;
  }
  return Array.from(groups, ([key, group]) => {
    const { votes } = group;
    const weighted = votes.reduce((sum, item) => sum + Number(item.score || 0) * Number(item.confidence || 0), 0);
    const confidenceTotal = votes.reduce((sum, item) => sum + Number(item.confidence || 0), 0);
    const score = confidenceTotal ? weighted / confidenceTotal : 0;
    const confidence = votes.length ? confidenceTotal / votes.length : 0;
    const wins = votes.filter((item) => item.decision === "win").length;
    const losses = votes.filter((item) => item.decision === "loss").length;
    const enoughEvidence = votes.length >= minTests && confidence >= minConfidence;
    return {
      key,
      evaluationCount: group.evaluationCount,
      experimentCount: votes.length,
      insufficientExperiments: group.insufficient,
      wins,
      losses,
      score: round(score, 4),
      confidence: round(confidence, 3),
      status: enoughEvidence && score >= 0.08
        ? "promoted"
        : enoughEvidence && score <= -0.08
          ? "demoted"
          : "testing",
      updatedAt: Math.max(0, ...votes.map((item) => Number(item.evaluatedAt) || 0))
    };
  }).sort((left, right) => right.score - left.score);
}

function latestSufficientEvaluation(evaluations) {
  return evaluations
    .filter((item) => item && item.sufficient !== false && item.decision !== "insufficient")
    .sort((left, right) => (WINDOW_RANK[right.windowId] || 0) - (WINDOW_RANK[left.windowId] || 0))[0] || null;
}

// Per-account medians over every video the account posted in the analysis
// window. Used to express a video's numbers as "x times what this account
// normally gets" so candidates and baselines posted on different accounts
// compare fairly.
export function buildAccountBaselines(videos = [], { minSamples = DEFAULT_EVIDENCE_POLICY.accountMinSamples } = {}) {
  const byAccount = new Map();
  for (const video of Array.isArray(videos) ? videos : []) {
    const username = String(video?.username || "").trim().toLowerCase();
    if (!username) continue;
    if (!byAccount.has(username)) byAccount.set(username, []);
    byAccount.get(username).push(videoMetrics(video));
  }
  const baselines = {};
  for (const [username, rows] of byAccount) {
    if (rows.length < Math.max(1, minSamples)) continue;
    baselines[username] = {
      sampleCount: rows.length,
      views: median(rows.map((row) => row.views)),
      retentionAt3: median(rows.map((row) => row.retentionAt3).filter(isFinite)),
      fullWatchRate: median(rows.map((row) => row.fullWatchRate).filter(isFinite)),
      averageWatchRatio: median(rows.map((row) => row.averageWatchRatio).filter(isFinite))
    };
  }
  return baselines;
}

// Turns a script (with per-video rows) or a plain metrics object into the four
// comparison metrics. With account baselines every video becomes a ratio to
// its account's median and the ratios are view-weighted; without them the raw
// view-weighted numbers are used.
export function normalizeAgainstAccounts(subject, accountBaselines) {
  const videos = Array.isArray(subject?.videos) ? subject.videos.map(videoMetrics) : [];
  if (!videos.length) {
    const metrics = normalizeMetrics(subject?.performance || subject || {});
    return { metrics, normalized: false, rawViews: metrics.views, accountCount: 0 };
  }
  const rawViews = videos.reduce((sum, row) => sum + row.views, 0);
  const raw = {
    views: rawViews,
    retentionAt3: weightedMean(videos, "retentionAt3"),
    fullWatchRate: weightedMean(videos, "fullWatchRate"),
    averageWatchRatio: weightedMean(videos, "averageWatchRatio")
  };
  const baselines = accountBaselines && typeof accountBaselines === "object" ? accountBaselines : null;
  if (!baselines) return { metrics: raw, normalized: false, rawViews, accountCount: 0 };
  const ratios = [];
  for (const row of videos) {
    const account = baselines[row.username];
    if (!account) continue;
    ratios.push({
      views: row.views,
      viewsRatio: account.views > 0 ? row.views / account.views : NaN,
      retentionAt3: ratio(row.retentionAt3, account.retentionAt3),
      fullWatchRate: ratio(row.fullWatchRate, account.fullWatchRate),
      averageWatchRatio: ratio(row.averageWatchRatio, account.averageWatchRatio)
    });
  }
  if (!ratios.length) return { metrics: raw, normalized: false, rawViews, accountCount: 0 };
  return {
    metrics: {
      views: weightedMean(ratios, "viewsRatio"),
      retentionAt3: weightedMean(ratios, "retentionAt3"),
      fullWatchRate: weightedMean(ratios, "fullWatchRate"),
      averageWatchRatio: weightedMean(ratios, "averageWatchRatio")
    },
    normalized: true,
    rawViews,
    accountCount: new Set(videos.filter((row) => baselines[row.username]).map((row) => row.username)).size
  };
}

export function normalizeMetrics(value = {}) {
  const duration = number(value.videoDuration ?? value.duration);
  const averageTime = number(value.averageTimeWatched ?? value.averageWatchTime);
  return {
    views: number(value.views ?? value.videoViews ?? value.totalViews),
    retentionAt3: rate(value.retentionAt3 ?? value.retention3s),
    fullWatchRate: rate(value.fullWatchRate ?? value.fullVideoWatchedRate),
    averageWatchRatio: duration > 0 ? Math.min(1, averageTime / duration) : rate(value.averageWatchRatio)
  };
}

function videoMetrics(video = {}) {
  const duration = number(video.duration ?? video.videoDuration);
  const averageTime = optional(video.averageTimeWatched ?? video.averageWatchTime);
  return {
    username: String(video.username || "").trim().toLowerCase(),
    views: number(video.views ?? video.videoViews),
    retentionAt3: optionalRate(video.retentionAt3 ?? video.retention3s),
    fullWatchRate: optionalRate(video.fullWatchRate ?? video.fullVideoWatchedRate),
    averageWatchRatio: duration > 0 && isFinite(averageTime) ? Math.min(1, averageTime / duration) : optionalRate(video.averageWatchRatio)
  };
}

function scoreDimension(name, candidate, baseline, weight, logarithmic = false) {
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline) || baseline <= 0) return null;
  const raw = logarithmic
    ? Math.log1p(candidate) / Math.log1p(baseline) - 1
    : candidate / baseline - 1;
  return { name, weight, score: round(Math.max(-1, Math.min(1, raw)), 4) };
}

function weightedMean(rows, key) {
  let total = 0;
  let weight = 0;
  for (const row of rows) {
    const value = Number(row[key]);
    if (!Number.isFinite(value)) continue;
    const w = Math.max(1, Number(row.views) || 0);
    total += value * w;
    weight += w;
  }
  return weight ? total / weight : NaN;
}

function ratio(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base <= 0) return NaN;
  return value / base;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isFinite(value) {
  return Number.isFinite(value);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function optional(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : NaN;
}

function rate(value) {
  const parsed = number(value);
  return parsed > 1 ? Math.min(1, parsed / 100) : parsed;
}

function optionalRate(value) {
  const parsed = optional(value);
  if (!Number.isFinite(parsed)) return NaN;
  return parsed > 1 ? Math.min(1, parsed / 100) : parsed;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}
