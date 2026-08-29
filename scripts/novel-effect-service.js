import { decorate, flattenOfficialVideos, normalizeRecords } from "./novel-effect-core.js";

const SOURCES = new Set(["official_api", "third_party"]);

export function createNovelEffectService({
  novelContentLibrary,
  officialAnalyticsService,
  readPublishRecords = () => [],
} = {}) {
  if (!novelContentLibrary) throw new Error("Novel effect service requires the novel content library.");

  async function getOverview({ source = "official_api", query = "", days = 30 } = {}) {
    if (!SOURCES.has(source)) throw statusError(400, "Unsupported data source.");
    const safeDays = Math.max(1, Math.min(30, Math.floor(Number(days) || 30)));

    if (source === "third_party") {
      const overview = novelContentLibrary.getOverview({ query });
      return decorate(overview, {
        source,
        label: "GeeLark third-party data",
        status: "ready",
        rawVideoCount: Number(overview?.summary?.videoCount || 0),
        mappedVideoCount: Number(overview?.summary?.videoCount || 0),
        days: safeDays,
      });
    }

    return getDecisionContext({ query, days: safeDays });
  }

  async function getDecisionContext({ signals = null, query = "", days = 30 } = {}) {
    const safeDays = Math.max(1, Math.min(30, Math.floor(Number(days) || 30)));
    if (!signals && !officialAnalyticsService?.getOperationSignals) {
      return decorate({ summary: {}, novels: [], unassignedScripts: [], query }, {
        source: "official_api",
        label: "TikTok official API",
        status: "unavailable",
        error: "Official TikTok data service is not configured.",
        rawVideoCount: 0,
        mappedVideoCount: 0,
        days: safeDays,
      });
    }
    try {
      const resolvedSignals = signals || await officialAnalyticsService.getOperationSignals({
        days: safeDays,
        videosPerAccount: 100,
      });
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
      });
    }
  }

  return { getOverview, getDecisionContext };
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
