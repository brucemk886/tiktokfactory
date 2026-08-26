const STORE_VERSION = 1;
const NOVEL_PLATFORMS = ["GoodNovel", "MotoNovel", "NovelMaster"];
const HIT_LIMIT = 50;
const HIT_MIN_VIEWS = 200;

export function buildOverview(store, audioItems, matchedVideos, query) {
  const audioById = new Map((audioItems || []).map((item) => [item.id, item]));
  const scriptByAudioKey = new Map();
  for (const script of store.scripts || []) {
    const audio = audioById.get(script.audioId);
    for (const value of [script.audioId, audio?.fileName, basename(audio?.targetAudioPath), audio?.title]) {
      const key = mediaKey(value);
      if (key && !scriptByAudioKey.has(key)) scriptByAudioKey.set(key, script);
    }
  }
  const videosByScript = new Map((store.scripts || []).map((script) => [script.id, []]));
  for (const video of Array.isArray(matchedVideos) ? matchedVideos : []) {
    const local = video?.local || {};
    let script = null;
    for (const value of [local.audioLibraryId, local.sourceAudioId, local.audioName, local.scriptId]) {
      script = scriptByAudioKey.get(mediaKey(value)) || (store.scripts || []).find((item) => item.id === value) || null;
      if (script) break;
    }
    if (!script) continue;
    videosByScript.get(script.id)?.push(compactVideo(video));
  }
  const scripts = (store.scripts || []).map((script) => {
    const audio = audioById.get(script.audioId) || script.audio || null;
    const videos = (videosByScript.get(script.id) || []).sort((a, b) => b.publishedAt - a.publishedAt);
    return { ...script, audio: compactAudio(audio), performance: summarizeVideos(videos), videos: videos.slice(0, 50) };
  });
  const scriptsByNovel = new Map();
  for (const script of scripts) {
    if (!scriptsByNovel.has(script.novelId)) scriptsByNovel.set(script.novelId, []);
    scriptsByNovel.get(script.novelId).push(script);
  }
  const normalizedQuery = clean(query).toLowerCase();
  const novels = annotatePlatformCatalog((store.novels || []).map((novel) => {
    const novelScripts = scriptsByNovel.get(novel.id) || [];
    const allVideos = novelScripts.flatMap((script) => script.videos);
    return { ...novel, scripts: novelScripts, performance: summarizeVideos(allVideos) };
  })).filter((novel) => !normalizedQuery || [novel.id, novel.title, novel.platform, novel.promotionCode, novel.promotionCopy, novel.category]
    .some((value) => String(value || "").toLowerCase().includes(normalizedQuery)));
  const knownNovelIds = new Set((store.novels || []).map((novel) => novel.id));
  const unassignedScripts = scripts.filter((script) => !script.novelId || !knownNovelIds.has(script.novelId));
  return {
    version: STORE_VERSION,
    summary: {
      novelCount: (store.novels || []).length,
      scriptCount: scripts.length,
      audioCount: scripts.filter((item) => item.audio).length,
      videoCount: scripts.reduce((sum, item) => sum + item.performance.videoCount, 0),
      unassignedScriptCount: unassignedScripts.length
    },
    catalog: buildCatalogSummary(novels),
    novels,
    unassignedScripts,
    query: clean(query),
  };
}

export function scriptHasAudio(script) {
  return Boolean(String(script?.audioId || script?.audio?.id || "").trim());
}

export function dropDraftScripts(scripts = [], { novelId = "", keepIds = [], graceMs = 0 } = {}) {
  const keep = new Set((Array.isArray(keepIds) ? keepIds : []).map((id) => String(id || "").trim()).filter(Boolean));
  const cutoff = Number(graceMs) > 0 ? Date.now() - Number(graceMs) : 0;
  const targetNovelId = String(novelId || "").trim();
  return (Array.isArray(scripts) ? scripts : []).filter((script) => {
    if (targetNovelId && String(script?.novelId || "") !== targetNovelId) return true;
    if (scriptHasAudio(script)) return true;
    if (keep.has(String(script?.id || ""))) return true;
    if (cutoff && Date.parse(script?.createdAt || 0) >= cutoff) return true;
    return false;
  });
}

export function removeDraftScriptsById(scripts = [], scriptIds = []) {
  const drop = new Set((Array.isArray(scriptIds) ? scriptIds : []).map((id) => String(id || "").trim()).filter(Boolean));
  if (!drop.size) return Array.isArray(scripts) ? scripts : [];
  return (Array.isArray(scripts) ? scripts : []).filter((script) => !drop.has(String(script?.id || "")) || scriptHasAudio(script));
}

export function audioItemsFromScripts(scripts = []) {
  return scripts.map((script) => ({
    id: script.audioId || script.audio?.id || "",
    fileName: script.audio?.fileName || script.audio?.title || "",
    title: script.audio?.title || script.title || "",
    targetAudioPath: script.audio?.targetAudioPath || "",
  })).filter((item) => item.id);
}

function compactAudio(audio) {
  if (!audio) return null;
  return {
    id: audio.id,
    title: audio.title,
    duration: Number(audio.duration) || 0,
    size: Number(audio.size) || 0,
    createdAt: audio.createdAt || "",
    scriptChars: Number(audio.scriptChars) || 0,
    targetAudioPath: String(audio.targetAudioPath || "").trim(),
    sourceType: String(audio.source?.type || audio.sourceType || "").trim(),
    playbackSpeed: Number(audio.playbackSpeed) || 1
  };
}

function compactVideo(video) {
  return {
    videoId: clean(video.id || video.videoId),
    username: clean(video.username),
    caption: clean(video.description || video.caption).slice(0, 500),
    publishedAt: Number(video.publishedAt || video.createTime || video.createdAt) || 0,
    views: number(video.views), likes: number(video.likes), comments: number(video.comments),
    shares: number(video.shares), bookmarks: number(video.bookmarks ?? video.favorites), duration: number(video.duration),
    averageTimeWatched: nullableNumber(video.averageTimeWatched),
    fullWatchRate: nullableRate(video.fullWatchRate),
    retentionAt3: nullableRate(video.retentionAt3),
    retentionAt5: nullableRate(video.retentionAt5),
    retentionAt10: nullableRate(video.retentionAt10),
    largestRetentionDrop: nullableNumber(video.largestRetentionDrop),
    largestRetentionDropSecond: nullableNumber(video.largestRetentionDropSecond),
    retentionCurve: Array.isArray(video.retentionCurve) ? video.retentionCurve.slice(0, 600) : [],
    matchConfidence: clean(video.local?.matchConfidence)
  };
}

function summarizeVideos(videos) {
  const rows = Array.isArray(videos) ? videos : [];
  const views = rows.map((item) => number(item.views));
  const totalViews = views.reduce((sum, value) => sum + value, 0);
  const averageWatch = averageAvailable(rows, "averageTimeWatched");
  const completion = averageAvailable(rows, "fullWatchRate");
  const retention3 = averageAvailable(rows, "retentionAt3");
  return {
    videoCount: rows.length,
    accountCount: new Set(rows.map((item) => clean(item.username).toLowerCase()).filter(Boolean)).size,
    totalViews,
    averageViews: rows.length ? Math.round(totalViews / rows.length) : 0,
    maxViews: views.length ? Math.max(...views) : 0,
    comments: rows.reduce((sum, item) => sum + number(item.comments), 0),
    averageTimeWatched: averageWatch,
    fullWatchRate: completion,
    retentionAt3: retention3,
    diagnosis: diagnosePerformance({ rows, totalViews, averageWatch, completion, retention3 })
  };
}

function averageAvailable(rows, key) {
  const values = rows.map((item) => item[key]).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function annotatePlatformCatalog(novels) {
  const groups = new Map();
  for (const novel of novels) {
    const platform = novel.platform || "未设置";
    if (!groups.has(platform)) groups.set(platform, []);
    groups.get(platform).push(novel);
  }
  for (const items of groups.values()) {
    const ranked = [...items]
      .filter((item) => number(item.performance?.totalViews) >= HIT_MIN_VIEWS || number(item.performance?.maxViews) >= HIT_MIN_VIEWS)
      .sort((a, b) => {
        const viewDiff = number(b.performance?.totalViews) - number(a.performance?.totalViews);
        if (viewDiff) return viewDiff;
        return number(b.performance?.maxViews) - number(a.performance?.maxViews);
      })
      .slice(0, HIT_LIMIT);
    const hitRank = new Map(ranked.map((item, index) => [item.id, index + 1]));
    for (const novel of items) {
      const rank = hitRank.get(novel.id) || 0;
      novel.featured = Boolean(novel.featured);
      novel.hit = rank > 0;
      novel.hitRank = rank || null;
      novel.hitLabel = rank ? `平台播放 Top ${rank}` : "";
    }
  }
  return novels;
}

function buildCatalogSummary(novels) {
  const rows = Array.isArray(novels) ? novels : [];
  return {
    platforms: NOVEL_PLATFORMS.map((platform) => summarizeCatalogGroup(platform, rows.filter((item) => item.platform === platform))),
    totals: summarizeCatalogGroup("all", rows)
  };
}

function summarizeCatalogGroup(platform, items) {
  return {
    platform,
    novelCount: items.length,
    featuredCount: items.filter((item) => item.featured).length,
    hitCount: items.filter((item) => item.hit).length
  };
}

function diagnosePerformance({ rows, totalViews, averageWatch, completion, retention3 }) {
  if (!rows.length) return "尚未匹配发布视频";
  if (retention3 !== null && retention3 < 0.7) return "前3秒流失偏高，优先重写开头钩子";
  if (completion !== null && completion < 0.25) return "完播偏低，建议压缩中段铺垫";
  if (rows.length && totalViews / rows.length < 200) return "播放样本偏低，建议继续跨账号测试";
  if (retention3 !== null && completion !== null) return "留存表现稳定，可保留并扩大测试";
  return "数据维度不足，等待官方指标补齐";
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function nullableRate(value) {
  const parsed = nullableNumber(value);
  if (parsed === null) return null;
  return parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
}

function mediaKey(value) {
  return clean(value).toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^a-z0-9]+/g, "");
}

function basename(value) {
  const text = String(value || "").replace(/\\/g, "/");
  return text.split("/").pop() || "";
}

function clean(value) {
  return String(value ?? "").trim();
}

function number(value) {
  return Math.max(0, Number(value) || 0);
}
