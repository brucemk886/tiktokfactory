import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STORE_VERSION = 1;
const NOVEL_PLATFORMS = ["GoodNovel", "MotoNovel", "NovelMaster"];
const NOVEL_PLATFORM_SET = new Set(NOVEL_PLATFORMS);
const HIT_LIMIT = 50;
const HIT_MIN_VIEWS = 200;

export function createNovelContentLibraryService({
  workDir,
  audioLibrary,
  analyticsService = null,
  readPublishRecords = () => [],
  now = () => Date.now()
} = {}) {
  if (!workDir) throw new Error("Novel content library requires a work directory.");
  const storePath = path.join(workDir, "novel-content-library.json");

  function syncedStore() {
    const store = syncAudioScripts(readStore(storePath), audioLibrary?.list?.() || [], now());
    writeStoreIfChanged(storePath, store);
    return store;
  }

  function getOverview({ query = "" } = {}) {
    const store = syncedStore();
    const videos = analyticsService?.getMatchedVideos?.(readPublishRecords()) || [];
    return buildOverview(store, audioLibrary?.list?.() || [], videos, query);
  }

  function getOverviewFromVideos(videos = [], { query = "" } = {}) {
    const store = syncedStore();
    return buildOverview(store, audioLibrary?.list?.() || [], Array.isArray(videos) ? videos : [], query);
  }

  function getAiContext() {
    const store = syncedStore();
    return {
      novels: store.novels.map((novel) => ({
        id: novel.id,
        title: novel.title,
        platform: novel.platform,
        promotionCode: novel.promotionCode,
        promotionCopy: novel.promotionCopy,
        category: novel.category,
        sourceExcerpt: novel.sourceContent.slice(0, 4_000)
      })),
      scripts: store.scripts.map((script) => ({
        id: script.id,
        novelId: script.novelId,
        parentScriptId: script.parentScriptId,
        hookVariantId: script.hookVariantId,
        audioId: script.audioId,
        title: script.title,
        text: script.text,
        versionLabel: script.versionLabel,
        sourceType: script.sourceType
      }))
    };
  }

  function createNovel(payload = {}) {
    const title = clean(payload.title).slice(0, 180);
    const sourceContent = String(payload.sourceContent || "").trim().slice(0, 200_000);
    if (!title) throw statusError(400, "请填写小说名称。");
    if (sourceContent.length < 20) throw statusError(400, "小说内容至少需要 20 个字符。");
    const store = readStore(storePath);
    const createdAt = new Date(now()).toISOString();
    const novel = {
      id: uniqueId("novel", title),
      title,
      platform: requireNovelPlatform(payload.platform),
      promotionCode: clean(payload.promotionCode).slice(0, 240),
      promotionCopy: clean(payload.promotionCopy).slice(0, 5_000),
      category: clean(payload.category).slice(0, 120),
      featured: asBoolean(payload.featured),
      sourceContent,
      sourceFingerprint: fingerprint(sourceContent),
      status: "active",
      createdAt,
      updatedAt: createdAt
    };
    store.novels.push(novel);
    writeStore(storePath, store);
    return novel;
  }

  function updateNovel(id, payload = {}) {
    const store = readStore(storePath);
    const novel = store.novels.find((item) => item.id === safeId(id));
    if (!novel) throw statusError(404, "没有找到该小说。");
    if (payload.title !== undefined) novel.title = clean(payload.title).slice(0, 180) || novel.title;
    if (payload.platform !== undefined) novel.platform = requireNovelPlatform(payload.platform);
    if (payload.promotionCode !== undefined) novel.promotionCode = clean(payload.promotionCode).slice(0, 240);
    if (payload.promotionCopy !== undefined) novel.promotionCopy = clean(payload.promotionCopy).slice(0, 5_000);
    if (payload.category !== undefined) novel.category = clean(payload.category).slice(0, 120);
    if (payload.featured !== undefined) novel.featured = asBoolean(payload.featured);
    if (payload.sourceContent !== undefined) {
      const sourceContent = String(payload.sourceContent || "").trim().slice(0, 200_000);
      if (sourceContent.length < 20) throw statusError(400, "小说内容至少需要 20 个字符。");
      novel.sourceContent = sourceContent;
      novel.sourceFingerprint = fingerprint(sourceContent);
    }
    novel.updatedAt = new Date(now()).toISOString();
    writeStore(storePath, store);
    return novel;
  }

  function assignScript(scriptId, payload = {}) {
    const store = syncedStore();
    const script = store.scripts.find((item) => item.id === safeId(scriptId) || item.audioId === safeId(scriptId));
    if (!script) throw statusError(404, "没有找到该文案。");
    const novelId = safeId(payload.novelId);
    if (novelId && !store.novels.some((item) => item.id === novelId)) throw statusError(404, "没有找到目标小说。");
    script.novelId = novelId;
    if (payload.versionLabel !== undefined) script.versionLabel = clean(payload.versionLabel).slice(0, 100);
    script.updatedAt = new Date(now()).toISOString();
    writeStore(storePath, store);
    return script;
  }

  function importMarketingResult(record = {}, payload = {}) {
    const sourceContent = String(payload.sourceText || "").trim().slice(0, 200_000);
    if (!sourceContent || !record?.id) return { novelId: "", scriptIds: [] };
    const store = readStore(storePath);
    const sourceFingerprint = fingerprint(sourceContent);
    let novel = store.novels.find((item) => item.sourceFingerprint === sourceFingerprint);
    if (!novel) {
      const createdAt = new Date(now()).toISOString();
      novel = {
        id: uniqueId("novel", payload.title || record.marketing?.packageTitle),
        title: clean(payload.title || record.marketing?.packageTitle || "未命名小说").slice(0, 180),
        platform: clean(payload.platform).slice(0, 120),
        promotionCode: clean(payload.promotionCode).slice(0, 240),
        promotionCopy: clean(payload.promotionCopy).slice(0, 5_000),
        category: clean(payload.category).slice(0, 120),
        featured: asBoolean(payload.featured),
        sourceContent,
        sourceFingerprint,
        status: "active",
        createdAt,
        updatedAt: createdAt
      };
      store.novels.push(novel);
    }
    const scriptIds = [];
    for (const selected of record.marketing?.selected || []) {
      const rank = Math.max(1, Number(selected.rank) || 1);
      const id = safeId(`script-${record.id}-${rank}`);
      const current = store.scripts.find((item) => item.id === id);
      const next = {
        id,
        novelId: novel.id,
        parentScriptId: "",
        hookVariantId: safeId(`hook-${record.id}-${selected.sourceHookId || rank}`),
        audioId: current?.audioId || "",
        marketingId: safeId(record.id),
        marketingRank: rank,
        title: clean(selected.title || `${novel.title} 文案 ${rank}`).slice(0, 240),
        text: String(selected.script || "").trim().slice(0, 20_000),
        versionLabel: clean(selected.angle || `开头版本 ${rank}`).slice(0, 100),
        sourceType: "ai-marketing",
        sourceVideoId: "",
        mixEnabled: current?.mixEnabled !== false,
        createdAt: current?.createdAt || record.generatedAt || new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString()
      };
      if (current) Object.assign(current, next);
      else store.scripts.push(next);
      scriptIds.push(id);
    }
    writeStore(storePath, store);
    return { novelId: novel.id, scriptIds };
  }

  function getNovel(id) {
    const wanted = safeId(id) || clean(id);
    const novel = getOverview().novels.find((item) => item.id === wanted || item.id === clean(id));
    if (!novel) throw statusError(404, "没有找到该小说。");
    return novel;
  }

  function createScript(novelId, payload = {}) {
    const store = syncedStore();
    const novel = store.novels.find((item) => item.id === safeId(novelId));
    if (!novel) throw statusError(404, "没有找到该小说。");
    const text = String(payload.text || "").trim().slice(0, 20_000);
    if (text.length < 20) throw statusError(400, "改写文案至少需要 20 个字符。");
    const parentId = safeId(payload.parentScriptId);
    if (parentId && !store.scripts.some((item) => item.id === parentId && item.novelId === novel.id)) {
      throw statusError(400, "原文案不属于这本小说。");
    }
    const createdAt = new Date(now()).toISOString();
    const script = {
      id: uniqueId("script", `${novel.id}:${text}`),
      novelId: novel.id,
      parentScriptId: parentId,
      hookVariantId: uniqueId("hook", text),
      audioId: "",
      title: clean(payload.title).slice(0, 240) || `${novel.title} 改写`,
      text,
      versionLabel: clean(payload.versionLabel).slice(0, 100) || "人工改写",
      sourceType: ["manual-rewrite", "ai-marketing", "ai-style-rewrite", "ai-operation-rewrite"].includes(payload.sourceType)
        ? payload.sourceType
        : "manual-rewrite",
      sourceVideoId: clean(payload.sourceVideoId).slice(0, 160),
      openingTitle: clean(payload.openingTitle || firstHookLine(text)).slice(0, 80),
      mixEnabled: true,
      createdAt,
      updatedAt: createdAt
    };
    store.scripts.push(script);
    writeStore(storePath, store);
    return script;
  }

  function attachScriptAudio(scriptId, audioId) {
    const store = readStore(storePath);
    const script = store.scripts.find((item) => item.id === safeId(scriptId));
    if (!script) throw statusError(404, "没有找到该文案。");
    const nextAudioId = safeId(audioId);
    if (!nextAudioId) throw statusError(400, "缺少有效的音频编号。");
    script.audioId = nextAudioId;
    script.updatedAt = new Date(now()).toISOString();
    writeStore(storePath, store);
    return script;
  }

  function setNovelMixAudios(novelId, scriptIds) {
    const store = syncedStore();
    const novel = store.novels.find((item) => item.id === safeId(novelId));
    if (!novel) throw statusError(404, "没有找到该小说。");
    const wanted = new Set((Array.isArray(scriptIds) ? scriptIds : []).map((id) => safeId(id)).filter(Boolean));
    const audioScripts = store.scripts.filter((item) => item.novelId === novel.id && item.audioId);
    if (!audioScripts.length) throw statusError(400, "这本小说还没有可勾选的音频。");
    const unknown = [...wanted].filter((id) => !audioScripts.some((item) => item.id === id));
    if (unknown.length) throw statusError(400, "勾选的音频不属于这本小说。");
    const timestamp = new Date(now()).toISOString();
    for (const script of audioScripts) {
      script.mixEnabled = wanted.has(script.id);
      script.updatedAt = timestamp;
    }
    writeStore(storePath, store);
    return getNovel(novel.id);
  }

  return { getOverview, getOverviewFromVideos, getAiContext, getNovel, createNovel, updateNovel, createScript, assignScript, attachScriptAudio, setNovelMixAudios, importMarketingResult };
}

function requireNovelPlatform(value) {
  const platform = normalizeNovelPlatform(value);
  if (!NOVEL_PLATFORM_SET.has(platform)) {
    throw statusError(400, "小说平台仅支持 GoodNovel、MotoNovel 或 NovelMaster。");
  }
  return platform;
}

function buildOverview(store, audioItems, matchedVideos, query) {
  const audioById = new Map(audioItems.map((item) => [item.id, item]));
  const scriptByAudioKey = new Map();
  for (const script of store.scripts) {
    const audio = audioById.get(script.audioId);
    for (const value of [script.audioId, audio?.fileName, basename(audio?.targetAudioPath), audio?.title]) {
      const key = mediaKey(value);
      if (key && !scriptByAudioKey.has(key)) scriptByAudioKey.set(key, script);
    }
  }
  const videosByScript = new Map(store.scripts.map((script) => [script.id, []]));
  for (const video of Array.isArray(matchedVideos) ? matchedVideos : []) {
    const local = video?.local || {};
    let script = null;
    for (const value of [local.audioLibraryId, local.sourceAudioId, local.audioName]) {
      script = scriptByAudioKey.get(mediaKey(value));
      if (script) break;
    }
    if (!script) continue;
    videosByScript.get(script.id)?.push(compactVideo(video));
  }
  const scripts = store.scripts.map((script) => {
    const audio = audioById.get(script.audioId) || null;
    const videos = (videosByScript.get(script.id) || []).sort((a, b) => b.publishedAt - a.publishedAt);
    return { ...script, audio: compactAudio(audio), performance: summarizeVideos(videos), videos: videos.slice(0, 50) };
  });
  const scriptsByNovel = new Map();
  for (const script of scripts) {
    if (!scriptsByNovel.has(script.novelId)) scriptsByNovel.set(script.novelId, []);
    scriptsByNovel.get(script.novelId).push(script);
  }
  const normalizedQuery = clean(query).toLowerCase();
  const novels = annotatePlatformCatalog(store.novels.map((novel) => {
    const novelScripts = scriptsByNovel.get(novel.id) || [];
    const allVideos = novelScripts.flatMap((script) => script.videos);
    return { ...novel, scripts: novelScripts, performance: summarizeVideos(allVideos) };
  })).filter((novel) => !normalizedQuery || [novel.id, novel.title, novel.platform, novel.promotionCode, novel.promotionCopy, novel.category, novel.sourceContent]
    .some((value) => String(value || "").toLowerCase().includes(normalizedQuery)));
  const knownNovelIds = new Set(store.novels.map((novel) => novel.id));
  const unassignedScripts = scripts.filter((script) => !script.novelId || !knownNovelIds.has(script.novelId));
  return {
    version: STORE_VERSION,
    summary: {
      novelCount: store.novels.length,
      scriptCount: scripts.length,
      audioCount: scripts.filter((item) => item.audio).length,
      videoCount: scripts.reduce((sum, item) => sum + item.performance.videoCount, 0),
      unassignedScriptCount: unassignedScripts.length
    },
    catalog: buildCatalogSummary(novels),
    novels,
    unassignedScripts
  };
}

function syncAudioScripts(store, audioItems, currentTime) {
  let changed = false;
  const timestamp = new Date(currentTime).toISOString();
  const scriptByAudioId = new Map(store.scripts.filter((item) => item.audioId).map((item) => [item.audioId, item]));
  const scriptByMarketing = new Map(store.scripts.filter((item) => item.marketingId && item.marketingRank)
    .map((item) => [`${item.marketingId}:${item.marketingRank}`, item]));
  for (const audio of audioItems) {
    let script = scriptByAudioId.get(audio.id);
    const marketingKey = `${safeId(audio.source?.marketingId)}:${Number(audio.source?.rank) || 0}`;
    if (!script && marketingKey !== ":0") script = scriptByMarketing.get(marketingKey);
    if (script) {
      if (script.audioId !== audio.id) {
        script.audioId = audio.id;
        script.updatedAt = timestamp;
        changed = true;
      }
      scriptByAudioId.set(audio.id, script);
      continue;
    }
    if (!String(audio.script || "").trim()) continue;
    const parent = scriptByAudioId.get(safeId(audio.source?.sourceAudioId));
    script = {
      id: safeId(`script-${audio.id}`),
      novelId: parent?.novelId || "",
      parentScriptId: parent?.id || "",
      hookVariantId: safeId(`hook-${audio.id}`),
      audioId: audio.id,
      marketingId: safeId(audio.source?.marketingId),
      marketingRank: Number(audio.source?.rank) || 0,
      title: clean(audio.title).slice(0, 240) || "未命名文案",
      text: String(audio.script || "").trim().slice(0, 20_000),
      versionLabel: audio.source?.type === "ai-operation-rewrite" ? "AI 数据定向改写" : "已有文案",
      sourceType: clean(audio.source?.type) || "audio-library",
      sourceVideoId: clean(audio.source?.sourceVideoId).slice(0, 160),
      createdAt: audio.createdAt || timestamp,
      updatedAt: timestamp
    };
    store.scripts.push(script);
    scriptByAudioId.set(audio.id, script);
    changed = true;
  }
  store.__changed = changed;
  return store;
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
    sourceType: String(audio.source?.type || "").trim(),
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
  const platforms = NOVEL_PLATFORMS.map((platform) => {
    const items = rows.filter((item) => item.platform === platform);
    return summarizeCatalogGroup(platform, items);
  });
  return {
    platforms,
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

function readStore(filePath) {
  try { return normalizeStore(JSON.parse(fs.readFileSync(filePath, "utf8"))); }
  catch { return normalizeStore({}); }
}

function normalizeStore(value) {
  return {
    version: STORE_VERSION,
    novels: Array.isArray(value?.novels) ? value.novels.map(normalizeNovel).filter((item) => item.id && item.title) : [],
    scripts: Array.isArray(value?.scripts) ? value.scripts.map(normalizeScript).filter((item) => item.id) : []
  };
}

function normalizeNovel(item) {
  return {
    id: safeId(item.id), title: clean(item.title).slice(0, 180),
    platform: normalizeNovelPlatform(item.platform), promotionCode: clean(item.promotionCode).slice(0, 240),
    promotionCopy: clean(item.promotionCopy).slice(0, 5_000),
    category: clean(item.category).slice(0, 120),
    featured: asBoolean(item.featured),
    sourceContent: String(item.sourceContent || "").trim().slice(0, 200_000),
    sourceFingerprint: clean(item.sourceFingerprint) || fingerprint(item.sourceContent), status: clean(item.status) || "active",
    createdAt: clean(item.createdAt), updatedAt: clean(item.updatedAt)
  };
}

function normalizeScript(item) {
  return {
    id: safeId(item.id), novelId: safeId(item.novelId), parentScriptId: safeId(item.parentScriptId),
    hookVariantId: safeId(item.hookVariantId), audioId: safeId(item.audioId), marketingId: safeId(item.marketingId),
    marketingRank: Number(item.marketingRank) || 0, title: clean(item.title).slice(0, 240),
    text: String(item.text || "").trim().slice(0, 20_000), versionLabel: clean(item.versionLabel).slice(0, 100),
    sourceType: clean(item.sourceType).slice(0, 80), sourceVideoId: clean(item.sourceVideoId).slice(0, 160),
    openingTitle: clean(item.openingTitle || firstHookLine(item.text)).slice(0, 80),
    mixEnabled: item.mixEnabled !== false,
    createdAt: clean(item.createdAt), updatedAt: clean(item.updatedAt)
  };
}

function writeStoreIfChanged(filePath, store) {
  if (!store.__changed) return;
  delete store.__changed;
  writeStore(filePath, store);
}

function writeStore(filePath, store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify({ version: STORE_VERSION, novels: store.novels, scripts: store.scripts }, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function uniqueId(prefix, seed) {
  return safeId(`${prefix}-${Date.now()}-${fingerprint(seed).slice(0, 8)}-${crypto.randomBytes(3).toString("hex")}`);
}

function fingerprint(value) { return crypto.createHash("sha256").update(String(value || "")).digest("hex"); }
function mediaKey(value) { return clean(value).toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^a-z0-9]+/g, ""); }
function basename(value) { return value ? path.basename(String(value)) : ""; }
function safeId(value) { return clean(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160); }
function clean(value) { return String(value ?? "").trim(); }
function firstHookLine(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const match = text.match(/^(.{8,72}?[.!?。！？])(?:\s|$)/);
  return (match?.[1] || text).slice(0, 72);
}
function asBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null || value === "") return false;
  const text = String(value).trim().toLowerCase();
  return text === "true" || text === "1" || text === "yes" || text === "on";
}
function normalizeNovelPlatform(value) { return clean(value) === "MasterNovel" ? "NovelMaster" : clean(value).slice(0, 120); }
function number(value) { return Math.max(0, Number(value) || 0); }
function statusError(statusCode, message) { return Object.assign(new Error(message), { statusCode }); }
