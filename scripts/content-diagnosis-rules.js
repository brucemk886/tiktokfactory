export const CONTENT_DIAGNOSIS_RULES_VERSION = "novel-content-v1";

const DAY_MS = 86_400_000;
const MIN_VIEWS = 200;
const MIN_AGE_MS = DAY_MS;

export function buildContentRuleDiagnostics({
  privateAnalytics = {},
  matchedVideos = [],
  scriptLibrary = [],
  generatedAt = Date.now()
} = {}) {
  const localByVideoId = buildLocalVideoIndex(matchedVideos);
  const scripts = buildScriptIndex(scriptLibrary);
  const diagnostics = [];

  for (const account of privateAnalytics.accounts || []) {
    const videos = Array.isArray(account?.videos) ? account.videos : [];
    const baselines = buildBaselines(videos, generatedAt);
    for (const video of videos) {
      const local = localByVideoId.get(clean(video.videoId || video.id)) || null;
      const script = resolveScript(local, scripts);
      diagnostics.push(diagnoseVideo({
        account,
        video,
        local,
        script,
        baseline: baselines.get(durationBucket(video.duration)) || baselines.get("all") || emptyBaseline(),
        generatedAt
      }));
    }
  }

  const counts = diagnostics.reduce((result, item) => {
    result[item.decision] = (result[item.decision] || 0) + 1;
    return result;
  }, {});
  return {
    version: CONTENT_DIAGNOSIS_RULES_VERSION,
    generatedAt,
    thresholds: {
      minimumViews: MIN_VIEWS,
      minimumPublishedHours: 24,
      openingLossPoints: 0.30,
      retention3BelowBaselinePoints: 0.15,
      retention3To10LossPoints: 0.20,
      weakAverageWatchRatio: 0.35,
      repeatedTestCount: 3
    },
    summary: {
      videoCount: diagnostics.length,
      mappedLocalVideoCount: diagnostics.filter((item) => item.mapping.localVideoMatched).length,
      mappedScriptCount: diagnostics.filter((item) => item.mapping.sourceAudioId).length,
      rewriteEligibleCount: diagnostics.filter((item) => item.rewriteEligible).length,
      decisions: counts
    },
    videos: diagnostics
  };
}

function diagnoseVideo({ account, video, local, script, baseline, generatedAt }) {
  const views = number(video.views);
  const duration = number(video.duration);
  const createdAtMs = normalizeTimestamp(video.createdAt);
  const ageHours = createdAtMs ? Math.max(0, (generatedAt - createdAtMs) / 3_600_000) : null;
  const mature = ageHours === null || ageHours >= 24;
  const enoughViews = views >= MIN_VIEWS;
  const sampleStatus = mature && enoughViews ? "eligible" : "insufficient";
  const retentionAt3 = optionalRatio(video.retentionAt3);
  const retentionAt10 = optionalRatio(video.retentionAt10);
  const retentionStart = firstCurveValue(video.retentionCurve);
  const openingLoss = retentionAt3 === null ? null : Math.max(0, (retentionStart ?? 1) - retentionAt3);
  const loss3To10 = retentionAt3 === null || retentionAt10 === null ? null : Math.max(0, retentionAt3 - retentionAt10);
  const averageWatchRatio = optionalRatio(video.averageWatchRatio)
    ?? (duration > 0 ? optionalRatio(number(video.averageTimeWatched) / duration) : null);
  const fullWatchRate = optionalRatio(video.fullWatchRate);
  const largestDropSecond = Math.max(0, number(video.largestRetentionDropSecond));
  const rules = [];

  if (!mature) rules.push(rule("sample_under_24h", "数据不足", "视频发布未满24小时，暂不自动改文。"));
  if (!enoughViews) rules.push(rule("sample_under_200_views", "数据不足", "播放不足200，暂不根据单条样本改文。"));
  if (sampleStatus === "eligible") {
    if (openingLoss !== null && openingLoss >= 0.30) {
      rules.push(rule("opening_loss_over_30pp", "开头问题", "前3秒流失超过30个百分点，重写第一句话并立即交代人物、冲突和悬念。"));
    }
    if (retentionAt3 !== null && baseline.retentionAt3 !== null && retentionAt3 <= baseline.retentionAt3 - 0.15) {
      rules.push(rule("retention3_below_peer_median", "开头问题", "3秒留存低于同账号相近时长视频中位数15个百分点，生成两个钩子版本。"));
    }
    if (loss3To10 !== null && loss3To10 >= 0.20) {
      rules.push(rule("rapid_loss_3_to_10", "铺垫问题", "3至10秒连续快速下降，删除背景铺垫并将冲突提前。"));
    }
    if (averageWatchRatio !== null && averageWatchRatio < 0.35) {
      rules.push(rule("average_watch_ratio_under_35", "中段节奏问题", "平均观看比例低于35%，压缩重复描述并提高事件推进速度。"));
    }
    const dropPosition = duration > 0 ? largestDropSecond / duration : null;
    if (dropPosition !== null && dropPosition >= 0.15 && dropPosition < 0.70 && number(video.largestRetentionDrop) >= 0.05) {
      rules.push(rule("mid_video_cliff", "中段节奏问题", "中段出现明显流失点，优先检查对应句子的长度、信息重复和剧情衔接。"));
    }
    if (dropPosition !== null && dropPosition >= 0.70 && number(video.largestRetentionDrop) >= 0.05) {
      rules.push(rule("late_video_cliff", "结尾回报问题", "70%进度后明显流失，延后答案并强化结尾回报。"));
    }
  }

  const retentionStrong = isAtLeast(retentionAt3, baseline.retentionAt3)
    && isAtLeast(averageWatchRatio, baseline.averageWatchRatio);
  const viewsStrong = baseline.views === null ? views >= 1_000 : views >= baseline.views;
  const viewsWeak = baseline.views === null ? views < MIN_VIEWS : views < Math.max(MIN_VIEWS, baseline.views * 0.6);
  const contentWeak = rules.some((item) => [
    "opening_loss_over_30pp",
    "retention3_below_peer_median",
    "rapid_loss_3_to_10",
    "average_watch_ratio_under_35",
    "mid_video_cliff",
    "late_video_cliff"
  ].includes(item.code));
  const repeatedWeak = number(script?.performance?.sampleCount) >= 3
    && number(script?.performance?.low200Rate) >= 85
    && contentWeak;

  let decision = "observe";
  let decisionReason = "当前证据不足以自动修改，继续积累样本。";
  if (sampleStatus === "insufficient") {
    decision = "observe";
    decisionReason = "视频未满24小时或播放不足200。";
  } else if (repeatedWeak) {
    decision = "stop_use";
    decisionReason = "同一文案已至少测试3次且持续低播放，并有明确内容流失证据。";
  } else if (contentWeak) {
    decision = "rewrite_test";
    decisionReason = "存在可定位的内容流失证据，生成最多两个局部改写版本。";
  } else if (viewsWeak && retentionStrong) {
    decision = "adjust_distribution";
    decisionReason = "留存不弱但播放不足，保留文案并调整标题、标签或发布时间。";
  } else if (viewsStrong && retentionStrong) {
    decision = "keep_reuse";
    decisionReason = "播放和留存均达到同账号相近时长基准，可提取结构继续复用。";
  }

  const timeline = script?.script && duration > 0 ? estimateSentenceTimeline(script.script, duration) : [];
  const dropSentence = timeline.find((item) => largestDropSecond >= item.startSecond && largestDropSecond < item.endSecond) || null;
  const sourceAudioId = clean(script?.id);
  const rewriteEligible = decision === "rewrite_test" && Boolean(sourceAudioId);
  return {
    username: normalizeAccount(account.username || account.profile?.username),
    videoId: clean(video.videoId || video.id),
    caption: clean(video.caption).slice(0, 500),
    duration,
    durationBucket: durationBucket(duration),
    views,
    ageHours: ageHours === null ? null : round(ageHours),
    sampleStatus,
    metrics: {
      retentionAt3,
      retentionAt5: optionalRatio(video.retentionAt5),
      retentionAt10,
      openingLoss,
      loss3To10,
      averageWatchRatio,
      fullWatchRate,
      largestRetentionDrop: optionalRatio(video.largestRetentionDrop),
      largestRetentionDropSecond: largestDropSecond,
      forYouRate: optionalRatio(video.forYouRate),
      searchRate: optionalRatio(video.searchRate),
      profileRate: optionalRatio(video.profileRate)
    },
    baseline,
    rules,
    decision,
    decisionReason,
    rewriteEligible,
    mapping: {
      localVideoMatched: Boolean(local),
      publishRecordId: clean(local?.recordId),
      localFileName: clean(local?.fileName),
      audioName: clean(local?.audioName),
      sourceAudioId,
      scriptId: clean(script?.scriptId),
      novelId: clean(script?.novelId),
      novelTitle: clean(script?.novelTitle),
      parentScriptId: clean(script?.parentScriptId),
      hookVariantId: clean(script?.hookVariantId),
      versionLabel: clean(script?.versionLabel),
      scriptTitle: clean(script?.title),
      mappingMode: local ? "existing_video_id_match" : "unmatched",
      sentenceTimingMode: timeline.length ? "estimated_from_script_character_share_v1" : "unavailable"
    },
    largestDropSentence: dropSentence,
    evidenceSummary: buildEvidenceSummary({ retentionAt3, retentionAt10, averageWatchRatio, fullWatchRate, largestDropSecond, decision })
  };
}

function buildBaselines(videos, generatedAt) {
  const buckets = new Map();
  for (const video of videos || []) {
    const createdAtMs = normalizeTimestamp(video.createdAt);
    if (number(video.views) < MIN_VIEWS || (createdAtMs && generatedAt - createdAtMs < MIN_AGE_MS)) continue;
    const key = durationBucket(video.duration);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(video);
    if (!buckets.has("all")) buckets.set("all", []);
    buckets.get("all").push(video);
  }
  return new Map(Array.from(buckets, ([key, values]) => [key, baselineOf(values)]));
}

function baselineOf(videos) {
  return {
    sampleCount: videos.length,
    views: median(videos.map((item) => number(item.views))),
    retentionAt3: medianOptional(videos.map((item) => optionalRatio(item.retentionAt3))),
    retentionAt10: medianOptional(videos.map((item) => optionalRatio(item.retentionAt10))),
    averageWatchRatio: medianOptional(videos.map((item) => optionalRatio(item.averageWatchRatio)
      ?? (number(item.duration) > 0 ? optionalRatio(number(item.averageTimeWatched) / number(item.duration)) : null))),
    fullWatchRate: medianOptional(videos.map((item) => optionalRatio(item.fullWatchRate)))
  };
}

function emptyBaseline() {
  return { sampleCount: 0, views: null, retentionAt3: null, retentionAt10: null, averageWatchRatio: null, fullWatchRate: null };
}

function buildLocalVideoIndex(videos) {
  const index = new Map();
  const rows = Array.isArray(videos) ? videos : [];
  for (const video of rows) {
    const id = clean(video.id || video.videoId);
    if (id && video.local) index.set(id, video.local);
  }
  return index;
}

function buildScriptIndex(items) {
  const byKey = new Map();
  for (const item of items || []) {
    for (const value of [item.id, item.title, item.fileName, basename(item.targetAudioPath)]) {
      const key = mediaKey(value);
      if (key && !byKey.has(key)) byKey.set(key, item);
    }
  }
  return byKey;
}

function resolveScript(local, scripts) {
  if (!local) return null;
  for (const value of [local.audioLibraryId, local.sourceAudioId, local.audioName]) {
    const item = scripts.get(mediaKey(value));
    if (item) return item;
  }
  return null;
}

function estimateSentenceTimeline(script, duration) {
  const sentences = clean(script).split(/(?<=[.!?。！？])\s+|\n+/).map(clean).filter(Boolean);
  const totalWeight = sentences.reduce((sum, sentence) => sum + Math.max(1, sentence.length), 0);
  let cursor = 0;
  return sentences.map((sentence, index) => {
    const startSecond = cursor;
    const endSecond = index === sentences.length - 1
      ? duration
      : Math.min(duration, cursor + duration * Math.max(1, sentence.length) / totalWeight);
    cursor = endSecond;
    return { index, startSecond: round(startSecond), endSecond: round(endSecond), text: sentence.slice(0, 500), exact: false };
  });
}

function buildEvidenceSummary({ retentionAt3, retentionAt10, averageWatchRatio, fullWatchRate, largestDropSecond, decision }) {
  return [
    `3秒留存 ${percent(retentionAt3)}`,
    `10秒留存 ${percent(retentionAt10)}`,
    `平均观看比例 ${percent(averageWatchRatio)}`,
    `完播率 ${percent(fullWatchRate)}`,
    `最大流失点 ${largestDropSecond || 0}秒`,
    `规则结论 ${decision}`
  ].join("；");
}

function durationBucket(value) {
  const duration = number(value);
  if (duration <= 15) return "0-15s";
  if (duration <= 30) return "16-30s";
  if (duration <= 60) return "31-60s";
  if (duration <= 120) return "61-120s";
  return "120s+";
}

function rule(code, category, action) {
  return { code, category, action };
}

function firstCurveValue(curve) {
  const values = (curve || []).map((item) => optionalRatio(item?.percentage)).filter((value) => value !== null);
  return values.length ? values[0] : null;
}

function isAtLeast(value, baseline) {
  if (value === null || value === undefined) return false;
  return baseline === null || baseline === undefined ? value >= 0.35 : value >= baseline;
}

function normalizeTimestamp(value) {
  const numeric = number(value);
  if (!numeric) return 0;
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianOptional(values) {
  return median(values.filter((value) => value !== null && value !== undefined));
}

function optionalRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

function percent(value) {
  return value === null || value === undefined ? "未返回" : `${round(value * 100)}%`;
}

function mediaKey(value) {
  return clean(value).toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function basename(value) {
  return clean(value).split(/[\\/]/).pop() || "";
}

function normalizeAccount(value) {
  return clean(value).replace(/^@/, "").toLowerCase();
}

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function round(value) {
  return Math.round(Number(value) * 10_000) / 10_000;
}

function clean(value) {
  return String(value ?? "").trim();
}
