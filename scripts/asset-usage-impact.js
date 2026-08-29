const REUSE_TIERS = [
  { key: "lt5", label: "素材均复用 <5", min: 0, max: 5 },
  { key: "5to9", label: "素材均复用 5–9", min: 5, max: 10 },
  { key: "gte10", label: "素材均复用 ≥10", min: 10, max: Infinity }
];

export function normalizeOutputId(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  const fileName = raw.split("/").pop() || "";
  const dot = fileName.lastIndexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName).toLowerCase();
}

export function isOfficialPublishRecord(record) {
  return record?.provider === "official" || record?.source === "official-tiktok";
}

export function buildPublishIndex(records = []) {
  const byOutput = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!isOfficialPublishRecord(record)) continue;
    const outputId = normalizeOutputId(record.fileName);
    if (!outputId) continue;
    const views = Number(record.officialVideo?.views ?? record.views);
    const entry = {
      outputId,
      fileName: String(record.fileName || ""),
      videoId: String(record.videoId || "").trim(),
      status: String(record.status || "").toLowerCase(),
      username: String(record.accountUsername || record.username || "").replace(/^@/, ""),
      views: Number.isFinite(views) ? views : 0,
      viewKnown: Number.isFinite(views)
    };
    if (!byOutput.has(outputId)) byOutput.set(outputId, []);
    byOutput.get(outputId).push(entry);
  }
  return byOutput;
}

export function collectGroupPublishVideos(group, usage, publishIndex, viewsByVideoId = new Map()) {
  const groupId = String(group?.id || "");
  const generated = (Array.isArray(usage?.generated) ? usage.generated : []).filter((item) => {
    const itemGroup = String(item.groupId || "");
    return !itemGroup || !groupId || itemGroup === groupId;
  });
  const views = viewsByVideoId instanceof Map ? viewsByVideoId : new Map(Object.entries(viewsByVideoId || {}));
  const videos = [];
  const seen = new Set();
  for (const item of generated) {
    const outputId = normalizeOutputId(item.outputId);
    const pubs = publishIndex.get(outputId) || [];
    if (!pubs.length) continue;
    const clips = Array.isArray(item.clips) ? item.clips : [];
    const useCounts = clips.map((clip) => Math.max(0, Number(usage?.assets?.[clip.assetId]?.usedCount) || 0));
    const avgReuse = useCounts.length ? round2(useCounts.reduce((sum, value) => sum + value, 0) / useCounts.length) : 0;
    const maxReuse = useCounts.length ? Math.max(...useCounts) : 0;
    const assetIds = [...new Set(clips.map((clip) => String(clip.assetId || "").trim()).filter(Boolean))];
    for (const pub of pubs) {
      const dedupe = pub.videoId || `${outputId}:${pub.username}:${pub.status}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const fromArchive = pub.videoId && views.has(pub.videoId);
      const nextViews = fromArchive ? Number(views.get(pub.videoId)) || 0 : Number(pub.views) || 0;
      videos.push({
        outputId: item.outputId || outputId,
        videoId: pub.videoId,
        status: pub.status,
        username: pub.username,
        views: nextViews,
        viewKnown: fromArchive || pub.viewKnown === true,
        avgReuse,
        maxReuse,
        assetIds
      });
    }
  }
  return { generatedCount: generated.length, videos };
}

export function summarizePublishImpact(videos = [], generatedVideos = 0) {
  const rows = Array.isArray(videos) ? videos : [];
  const known = rows.filter((video) => video.viewKnown);
  const knownViews = known.map((video) => Math.max(0, Number(video.views) || 0));
  return {
    generatedVideos: Math.max(0, Number(generatedVideos) || 0),
    publishedMatched: rows.length,
    withVideoId: rows.filter((video) => video.videoId).length,
    withViews: known.length,
    totalViews: knownViews.reduce((sum, value) => sum + value, 0),
    avgViews: averageNumber(knownViews),
    medianViews: medianNumber(knownViews),
    reuseTiers: REUSE_TIERS.map((tier) => {
      const inTier = rows.filter((video) => reuseTierKey(video.avgReuse) === tier.key);
      const tierKnown = inTier.filter((video) => video.viewKnown);
      const views = tierKnown.map((video) => Math.max(0, Number(video.views) || 0));
      return {
        key: tier.key,
        label: tier.label,
        videos: inTier.length,
        withViews: tierKnown.length,
        totalViews: views.reduce((sum, value) => sum + value, 0),
        avgViews: averageNumber(views),
        medianViews: medianNumber(views)
      };
    })
  };
}

export function summarizeAssetImpact(videos = []) {
  const rows = Array.isArray(videos) ? videos : [];
  const known = rows.filter((video) => video.viewKnown);
  const views = known.map((video) => Math.max(0, Number(video.views) || 0));
  return {
    matchedVideos: rows.length,
    withVideoId: rows.filter((video) => video.videoId).length,
    withViews: known.length,
    totalViews: views.reduce((sum, value) => sum + value, 0),
    avgViews: averageNumber(views),
    medianViews: medianNumber(views)
  };
}

export function collectSnapshotVideoIds(snapshot) {
  const ids = [];
  for (const dash of Object.values(snapshot?.dashboards || {})) {
    for (const video of dash.videos || []) {
      const videoId = String(video.videoId || "").trim();
      if (videoId) ids.push(videoId);
    }
    for (const asset of dash.highReuseAssets || []) {
      for (const videoId of asset.matchedVideoIds || []) {
        if (videoId) ids.push(String(videoId));
      }
    }
  }
  return [...new Set(ids)];
}

export function applyArchiveViewsToSnapshot(snapshot, viewsByVideoId) {
  if (!snapshot?.dashboards) return snapshot;
  const views = viewsByVideoId instanceof Map ? viewsByVideoId : new Map(Object.entries(viewsByVideoId || {}));
  const dashboards = {};
  for (const [groupId, dash] of Object.entries(snapshot.dashboards)) {
    const videos = (Array.isArray(dash.videos) ? dash.videos : []).map((video) => {
      const videoId = String(video.videoId || "").trim();
      if (videoId && views.has(videoId)) {
        return { ...video, views: Number(views.get(videoId)) || 0, viewKnown: true };
      }
      return video;
    });
    dashboards[groupId] = {
      ...dash,
      videos,
      impact: summarizePublishImpact(videos, Number(dash.impact?.generatedVideos || dash.group?.generatedVideos) || 0),
      highReuseAssets: (Array.isArray(dash.highReuseAssets) ? dash.highReuseAssets : []).map((row) => {
        const matchedIds = new Set((row.matchedVideoIds || []).map(String));
        const matched = videos.filter((video) => video.videoId && matchedIds.has(String(video.videoId)));
        return { ...row, impact: summarizeAssetImpact(matched.length ? matched : videos.filter((video) => matchedIds.has(String(video.videoId)))) };
      })
    };
  }
  return { ...snapshot, dashboards, viewsEnriched: true };
}

export function dashboardFromSnapshot(snapshot, groupId = "") {
  const groups = Array.isArray(snapshot?.groups) ? snapshot.groups : [];
  if (!groups.length) return emptyAssetUsageDashboard(Number(snapshot?.sampledAt) || 0);
  const selected = groups.find((group) => group.id === groupId) || groups[0];
  const dash = snapshot?.dashboards?.[selected.id] || {};
  return {
    groups,
    sampledAt: Number(snapshot?.sampledAt) || 0,
    viewsEnriched: snapshot?.viewsEnriched === true,
    group: dash.group || selected,
    summary: dash.summary && typeof dash.summary === "object" ? dash.summary : emptyUsageSummary(),
    impact: dash.impact || emptyUsageImpact(),
    folders: Array.isArray(dash.folders) ? dash.folders : [],
    highReuseAssets: (Array.isArray(dash.highReuseAssets) ? dash.highReuseAssets : []).map((row) => {
      const { matchedVideoIds, ...publicRow } = row;
      return publicRow;
    })
  };
}

export function emptyAssetUsageDashboard(sampledAt = 0) {
  return {
    groups: [],
    group: null,
    summary: emptyUsageSummary(),
    impact: emptyUsageImpact(),
    folders: [],
    highReuseAssets: [],
    sampledAt,
    viewsEnriched: false
  };
}

export function emptyUsageImpact() {
  return summarizePublishImpact([], 0);
}

function reuseTierKey(avgReuse) {
  const value = Number(avgReuse) || 0;
  if (value >= 10) return "gte10";
  if (value >= 5) return "5to9";
  return "lt5";
}

function emptyUsageSummary() {
  return {
    folder: "",
    totalAssets: 0,
    usedAssets: 0,
    totalDuration: 0,
    usedSeconds: 0,
    totalBuckets: 0,
    usedBuckets: 0,
    reusedBuckets: 0,
    maxBucketReuse: 0,
    clipUses: 0,
    coveragePercent: 0,
    freshPercent: 100,
    reusePressure: 0,
    risk: "low"
  };
}

function averageNumber(values) {
  return values.length ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

export function medianNumber(values) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : round2((nums[mid - 1] + nums[mid]) / 2);
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}
