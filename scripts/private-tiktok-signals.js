export function summarizeOperationSignals(accountSignals = [], options = {}) {
  const accounts = (accountSignals || []).map((account) => {
    const videos = (account.videos || []).map((video) => buildPrivateVideoSignal(video, account));
    return {
      schema: clean(account.schema),
      username: normalizeAccountName(account.username || account.profile?.username),
      videoCount: videos.length,
      ...aggregatePrivateVideos(videos),
      videos: videos.sort((left, right) => right.views - left.views).slice(0, 30)
    };
  }).filter((account) => account.username);
  const allVideos = accounts.flatMap((account) => account.videos);
  return {
    connected: true,
    status: allVideos.length ? "ready" : "empty",
    windowDays: Math.max(1, Number(options.days) || 10),
    requestedAccountCount: Math.max(0, Number(options.requestedAccountCount) || 0),
    matchedAccountCount: accounts.length,
    generatedAt: Number(options.generatedAt) || Date.now(),
    summary: aggregatePrivateVideos(allVideos),
    accounts
  };
}

function buildPrivateVideoSignal(video = {}, account = {}) {
  const duration = Math.max(0, Number(video.duration) || 0);
  const retention = normalizeCurve(video.retention, "second");
  const likeCurve = normalizeCurve(video.engagementLikes, "second");
  const retentionAt3 = curveValueAt(retention, 3);
  const retentionAt5 = curveValueAt(retention, 5);
  const retentionAt10 = curveValueAt(retention, 10);
  const retentionAt25 = duration ? curveValueAt(retention, duration * 0.25) : null;
  const retentionAt50 = duration ? curveValueAt(retention, duration * 0.5) : null;
  const retentionAt75 = duration ? curveValueAt(retention, duration * 0.75) : null;
  const retentionAtEnd = duration ? curveValueAt(retention, Math.max(0, duration - 1)) : null;
  const averageWatchRatio = duration > 0 ? ratio(Number(video.averageTimeWatched) / duration) : null;
  const fullWatchRate = optionalRatio(video.fullWatchRate);
  const sources = new Map((video.impressionSources || []).map((item) => [
    clean(item.impressionSource).toLowerCase(),
    optionalRatio(item.percentage)
  ]));
  const largestDrop = largestCurveDrop(retention);
  const views = Math.max(0, Number(video.views) || 0);
  const diagnosticEngagementRate = views > 0
    ? ratio(((Number(video.likes) || 0) + (Number(video.comments) || 0) + (Number(video.shares) || 0)) / views)
    : 0;
  let conflict = "";
  if (views >= 1_000 && ((retentionAt3 !== null && retentionAt3 < 0.45) || (averageWatchRatio !== null && averageWatchRatio < 0.25))) {
    conflict = "high_distribution_weak_retention";
  } else if (views <= 200 && retentionAt3 !== null && retentionAt3 >= 0.65 && averageWatchRatio !== null && averageWatchRatio >= 0.35) {
    conflict = "low_distribution_strong_retention";
  }
  return {
    schema: clean(account.schema),
    username: normalizeAccountName(account.username || account.profile?.username),
    videoId: clean(video.id),
    caption: clean(video.caption).slice(0, 500),
    createdAt: Number(video.createdAt) || 0,
    duration,
    views,
    reach: Math.max(0, Number(video.reach) || 0),
    likes: Math.max(0, Number(video.likes) || 0),
    comments: Math.max(0, Number(video.comments) || 0),
    shares: Math.max(0, Number(video.shares) || 0),
    favorites: Math.max(0, Number(video.favorites) || 0),
    profileViews: Math.max(0, Number(video.profileViews) || 0),
    newFollowers: Math.max(0, Number(video.newFollowers) || 0),
    averageTimeWatched: Math.max(0, Number(video.averageTimeWatched) || 0),
    totalTimeWatched: Math.max(0, Number(video.totalTimeWatched) || 0),
    averageWatchRatio,
    fullWatchRate,
    retentionAt3,
    retentionAt5,
    retentionAt10,
    retentionAt25,
    retentionAt50,
    retentionAt75,
    retentionAtEnd,
    largestRetentionDrop: largestDrop.value,
    largestRetentionDropSecond: largestDrop.second,
    forYouRate: findSourceRate(sources, ["for you", "foryou", "for_you"]),
    searchRate: findSourceRate(sources, ["search"]),
    profileRate: findSourceRate(sources, ["personal profile", "profile"]),
    diagnosticEngagementRate,
    conflict,
    retentionCurve: retention.map((point) => ({ second: point.second, percentage: point.value })),
    likeCurve: likeCurve.map((point) => ({ second: point.second, percentage: point.value })),
    impressionSources: normalizeBreakdown(video.impressionSources, "impressionSource"),
    audienceGender: normalizeBreakdown(video.audienceGender, "gender"),
    audienceCountry: normalizeBreakdown(video.audienceCountry, "country"),
    audienceCity: normalizeBreakdown(video.audienceCity, "cityName"),
    audienceType: normalizeBreakdown(video.audienceType, "type")
  };
}

function normalizeBreakdown(items, labelKey) {
  return (items || []).map((item) => ({
    label: clean(item?.[labelKey]),
    percentage: optionalRatio(item?.percentage)
  })).filter((item) => item.label && item.percentage !== null);
}

function aggregatePrivateVideos(videos = []) {
  const values = (videos || []).filter(Boolean);
  const average = (key) => optionalMean(values.map((item) => item[key]));
  return {
    detailedVideoCount: values.length,
    maxViews: values.reduce((max, item) => Math.max(max, Number(item.views) || 0), 0),
    averageViews: roundMetric(optionalMean(values.map((item) => item.views))),
    averageWatchRatio: roundMetric(average("averageWatchRatio")),
    averageFullWatchRate: roundMetric(average("fullWatchRate")),
    averageRetention3: roundMetric(average("retentionAt3")),
    averageRetention5: roundMetric(average("retentionAt5")),
    averageRetention10: roundMetric(average("retentionAt10")),
    averageRetention25: roundMetric(average("retentionAt25")),
    averageRetention50: roundMetric(average("retentionAt50")),
    averageRetention75: roundMetric(average("retentionAt75")),
    averageRetentionEnd: roundMetric(average("retentionAtEnd")),
    averageForYouRate: roundMetric(average("forYouRate")),
    averageSearchRate: roundMetric(average("searchRate")),
    conflictCount: values.filter((item) => item.conflict).length,
    highDistributionWeakRetentionCount: values.filter((item) => item.conflict === "high_distribution_weak_retention").length,
    lowDistributionStrongRetentionCount: values.filter((item) => item.conflict === "low_distribution_strong_retention").length
  };
}

function normalizeCurve(items, secondKey) {
  return (items || []).map((item) => ({
    second: Math.max(0, Number(item?.[secondKey]) || 0),
    value: optionalRatio(item?.percentage)
  })).filter((item) => item.value !== null).sort((left, right) => left.second - right.second);
}

function curveValueAt(curve, targetSecond) {
  if (!curve.length) return null;
  let nearest = curve[0];
  for (const point of curve) {
    if (Math.abs(point.second - targetSecond) < Math.abs(nearest.second - targetSecond)) nearest = point;
  }
  return nearest.value;
}

function largestCurveDrop(curve) {
  let value = 0;
  let second = 0;
  for (let index = 1; index < curve.length; index += 1) {
    const drop = curve[index - 1].value - curve[index].value;
    if (drop > value) {
      value = drop;
      second = curve[index].second;
    }
  }
  return { value: roundMetric(value), second };
}

function findSourceRate(sources, names) {
  for (const name of names) {
    if (sources.has(name)) return sources.get(name);
  }
  return null;
}

function optionalRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return ratio(numeric > 1 ? numeric / 100 : numeric);
}

function ratio(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
}

function optionalMean(values) {
  const numbers = values.filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function roundMetric(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? null
    : Math.round(Number(value) * 10_000) / 10_000;
}

function normalizeAccountName(value) {
  return clean(value).replace(/^@/, "").toLowerCase();
}

function clean(value) {
  return String(value ?? "").trim();
}
