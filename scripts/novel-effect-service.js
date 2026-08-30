import { decorate, flattenOfficialVideos, normalizeRecords } from "./novel-effect-core.js";
import { effectsLookbackDays, periodWindow, resolveEffectsPeriod } from "./official-group-report.js";

const SOURCES = new Set(["official_api", "third_party"]);

export function createNovelEffectService({
  novelContentLibrary,
  officialAnalyticsService,
  readPublishRecords = () => [],
} = {}) {
  if (!novelContentLibrary) throw new Error("Novel effect service requires the novel content library.");

  async function getOverview({ source = "official_api", query = "", days = 30, period = "" } = {}) {
    if (!SOURCES.has(source)) throw statusError(400, "Unsupported data source.");
    const resolvedPeriod = resolveEffectsPeriod({ period, days });
    const safeDays = effectsLookbackDays(resolvedPeriod);

    if (source === "third_party") {
      const overview = novelContentLibrary.getOverview({ query });
      return decorate(overview, {
        source,
        label: "GeeLark third-party data",
        status: "ready",
        rawVideoCount: Number(overview?.summary?.videoCount || 0),
        mappedVideoCount: Number(overview?.summary?.videoCount || 0),
        days: safeDays,
        period: resolvedPeriod,
      });
    }

    return getDecisionContext({ query, days: safeDays, period: resolvedPeriod });
  }

  async function getDecisionContext({ signals = null, query = "", days = 30, period = "" } = {}) {
    const resolvedPeriod = resolveEffectsPeriod({ period, days });
    const safeDays = effectsLookbackDays(resolvedPeriod);
    const window = periodWindow(resolvedPeriod);
    if (!signals && !officialAnalyticsService?.getOperationSignals) {
      return decorate({ summary: {}, novels: [], unassignedScripts: [], query }, {
        source: "official_api",
        label: "TikTok official API",
        status: "unavailable",
        error: "Official TikTok data service is not configured.",
        rawVideoCount: 0,
        mappedVideoCount: 0,
        days: safeDays,
        period: resolvedPeriod,
      });
    }
    try {
      const fetched = signals || await officialAnalyticsService.getOperationSignals({
        days: safeDays,
        videosPerAccount: 100,
      });
      const resolvedSignals = resolvedPeriod === "yesterday" || resolvedPeriod === "today"
        ? filterSignalsByWindow(fetched, window)
        : fetched;
      const records = normalizeRecords(readPublishRecords());
      const videos = flattenOfficialVideos(resolvedSignals, records);
      const overview = novelContentLibrary.getOverviewFromVideos(videos, { query });
      return {
        ...decorate(overview, {
          source: "official_api",
          label: "TikTok official API",
          status: resolvedSignals?.status || (resolvedSignals?.connected ? "ready" : "unavailable"),
          error: resolvedSignals?.error || "",
          rawVideoCount: countOfficialVideos(resolvedSignals),
          mappedVideoCount: videos.filter(hasContentMapping).length,
          days: safeDays,
          period: resolvedPeriod,
        }, { videos }),
        videoMappings: videos.map((video) => ({
          videoId: clean(video.videoId || video.itemId || video.id),
          username: clean(video.username),
          publishedAt: Number(video.publishedAt) || 0,
          local: video.local || {},
        })),
      };
    } catch (error) {
      return decorate({ summary: {}, novels: [], unassignedScripts: [], query }, {
        source: "official_api",
        label: "TikTok official API",
        status: "unavailable",
        error: error.message || "Official TikTok data request failed.",
        rawVideoCount: 0,
        mappedVideoCount: 0,
        days: safeDays,
        period: resolvedPeriod,
      });
    }
  }

  return { getOverview, getDecisionContext };
}

function filterSignalsByWindow(signals, window) {
  if (!window?.startAt || !window?.endAt) return signals;
  return {
    ...signals,
    accounts: (Array.isArray(signals?.accounts) ? signals.accounts : []).map((account) => ({
      ...account,
      videos: (Array.isArray(account?.videos) ? account.videos : []).filter((video) => {
        const createdAt = toMillis(video.createdAt || video.createTime || video.publishedAt);
        if (!createdAt) return true;
        return createdAt >= window.startAt && createdAt < window.endAt;
      }),
    })),
  };
}

function toMillis(value) {
  const number = Number(value) || 0;
  if (number <= 0) return 0;
  return number < 1e12 ? number * 1000 : number;
}

function countOfficialVideos(signals) {
  return (Array.isArray(signals?.accounts) ? signals.accounts : []).reduce(
    (total, account) => total + (Array.isArray(account?.videos) ? account.videos.length : 0), 0
  );
}

function hasContentMapping(video) {
  return Boolean(video.local?.audioLibraryId || video.local?.sourceAudioId || video.local?.audioName || video.local?.scriptId);
}

function clean(value) {
  return String(value ?? "").trim();
}

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
