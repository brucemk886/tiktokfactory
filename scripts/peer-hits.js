const TOP_KEYS = new Set([
  "id",
  "videoUrl", "video_url", "url", "link", "videoLink", "video_link", "视频链接", "视频地址", "视频url",
  "playCount", "play_count", "views", "viewCount", "view_count", "播放量", "播放",
  "novelTitle", "novel_title", "title", "bookTitle", "book_title", "小说名称", "书名", "小说名",
  "novelId", "novel_id", "bookId", "book_id", "书籍id", "书籍Id", "小说id", "小说ID",
  "platform", "平台", "novelPlatform", "novel_platform",
  "factoryNovelId", "factory_novel_id",
  "audioId", "audio_id", "audioName", "audio_name", "audioSize", "audio_size", "audio",
  "videoData", "video_data", "视频数据",
  "source", "importedAt", "imported_at", "updatedAt", "updated_at", "createdAt", "created_at"
]);

const VIDEO_URL_KEYS = ["videoUrl", "video_url", "url", "link", "videoLink", "video_link", "视频链接", "视频地址", "视频url"];
const PLAY_COUNT_KEYS = ["playCount", "play_count", "views", "viewCount", "view_count", "播放量", "播放"];
const NOVEL_TITLE_KEYS = ["novelTitle", "novel_title", "title", "bookTitle", "book_title", "小说名称", "书名", "小说名"];
const NOVEL_ID_KEYS = ["novelId", "novel_id", "bookId", "book_id", "书籍id", "书籍Id", "小说id", "小说ID"];
const PLATFORM_KEYS = ["platform", "平台", "novelPlatform", "novel_platform"];
const NOVEL_PLATFORMS = ["GoodNovel", "MotoNovel", "NovelMaster"];

export function normalizePeerHitPlatform(value) {
  const raw = String(value || "").replace(/\s+/g, "").trim();
  if (raw === "MasterNovel") return "NovelMaster";
  return NOVEL_PLATFORMS.includes(raw) ? raw : "";
}

export function pickFirst(item, keys) {
  if (!item || typeof item !== "object") return "";
  for (const key of keys) {
    if (item[key] == null) continue;
    const value = typeof item[key] === "object" ? "" : String(item[key]).trim();
    if (value) return value;
  }
  return "";
}

export function parsePlayCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const text = String(value || "").trim().replace(/,/g, "").replace(/\s/g, "");
  if (!text) return 0;
  const wan = text.match(/^([\d.]+)万$/);
  if (wan) return Math.max(0, Math.round(Number(wan[1]) * 10_000));
  const suffix = text.match(/^([\d.]+)([kmb])$/i);
  if (suffix) {
    const mul = { k: 1e3, m: 1e6, b: 1e9 }[suffix[2].toLowerCase()];
    return Math.max(0, Math.round(Number(suffix[1]) * mul));
  }
  const count = Number(text);
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

export function normalizeVideoKey(url) {
  const text = String(url || "").trim();
  const videoId = text.match(/\/video\/(\d+)/)?.[1] || text.match(/[?&]video_id=(\d+)/)?.[1];
  if (videoId) return `tiktok:${videoId}`;
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

export function newPeerHitId(now = Date.now()) {
  return `peer-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function collectImportItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["items", "hits", "videos", "records", "data", "导入"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (pickFirst(payload, VIDEO_URL_KEYS)) return [payload];
  return [];
}

export function normalizePeerHitInput(raw, options = {}) {
  const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const stamp = Number(options.now) || Date.now();
  const videoUrl = String(pickFirst(item, VIDEO_URL_KEYS)).trim().slice(0, 800);
  if (!videoUrl) {
    const error = new Error("请填写视频链接。");
    error.statusCode = 400;
    throw error;
  }
  const videoData = readVideoData(item);
  const playCount = parsePlayCount(pickFirst(item, PLAY_COUNT_KEYS) || videoData.playCount || videoData.播放量 || videoData.views);
  const novelTitle = String(pickFirst(item, NOVEL_TITLE_KEYS)).trim().slice(0, 180);
  const novelId = String(pickFirst(item, NOVEL_ID_KEYS)).trim().slice(0, 240);
  const platform = normalizePeerHitPlatform(pickFirst(item, PLATFORM_KEYS));
  return {
    id: String(options.id || item.id || "").trim() || newPeerHitId(stamp),
    videoUrl,
    videoKey: normalizeVideoKey(videoUrl),
    playCount,
    novelTitle,
    novelId,
    platform,
    factoryNovelId: String(item.factoryNovelId || item.factory_novel_id || "").trim(),
    audioId: String(item.audioId || item.audio_id || "").trim(),
    audioName: String(item.audioName || item.audio_name || "").trim().slice(0, 240),
    audioSize: Number(item.audioSize || item.audio_size) || 0,
    videoData,
    source: String(item.source || options.source || "grokbot").trim().slice(0, 40) || "grokbot",
    importedAt: Number(item.importedAt || item.imported_at) || stamp,
    updatedAt: stamp
  };
}

export function matchFactoryNovel(hit, novels = []) {
  const factoryId = String(hit?.factoryNovelId || "").trim();
  if (factoryId) {
    const byFactory = novels.find((novel) => String(novel.id || "") === factoryId);
    if (byFactory) return byFactory;
  }
  const platform = normalizePeerHitPlatform(hit?.platform);
  const scoped = platform
    ? novels.filter((novel) => normalizePeerHitPlatform(novel.platform) === platform)
    : novels;
  const bookId = String(hit?.novelId || "").trim();
  if (bookId) {
    const byId = scoped.filter((novel) => String(novel.bookId || "").trim() === bookId || String(novel.id || "") === bookId);
    if (byId.length === 1) return byId[0];
  }
  const title = String(hit?.novelTitle || "").trim().toLowerCase();
  if (title) {
    const byTitle = scoped.filter((novel) => String(novel.title || "").trim().toLowerCase() === title);
    if (byTitle.length === 1) return byTitle[0];
  }
  return null;
}

export function attachFactoryNovel(hit, novels = []) {
  const matched = matchFactoryNovel(hit, novels);
  if (!matched) return { ...hit, factoryNovelId: hit.factoryNovelId || "" };
  return {
    ...hit,
    factoryNovelId: matched.id,
    novelTitle: hit.novelTitle || matched.title || "",
    novelId: hit.novelId || matched.bookId || "",
    platform: normalizePeerHitPlatform(hit.platform) || normalizePeerHitPlatform(matched.platform)
  };
}

export function mergePeerHit(current, incoming) {
  if (!current) return incoming;
  return {
    ...current,
    videoUrl: incoming.videoUrl || current.videoUrl,
    videoKey: incoming.videoKey || current.videoKey,
    playCount: Number.isFinite(incoming.playCount) ? incoming.playCount : current.playCount,
    novelTitle: incoming.novelTitle || current.novelTitle,
    novelId: incoming.novelId || current.novelId,
    platform: incoming.platform || current.platform || "",
    factoryNovelId: incoming.factoryNovelId || current.factoryNovelId,
    audioId: incoming.audioId || current.audioId || "",
    audioName: incoming.audioName || current.audioName || "",
    audioSize: incoming.audioId ? Number(incoming.audioSize) || 0 : Number(current.audioSize) || 0,
    videoData: { ...(current.videoData || {}), ...(incoming.videoData || {}) },
    source: incoming.source || current.source,
    importedAt: current.importedAt || incoming.importedAt,
    updatedAt: incoming.updatedAt
  };
}

export function filterPeerHits(items, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const list = Array.isArray(items) ? items : [];
  if (!needle) return list;
  return list.filter((item) => [
    item.novelTitle,
    item.novelId,
    item.platform,
    item.factoryNovelId,
    item.importedToAudioBoard ? "是 已写入音频页" : "否",
    item.videoUrl,
    item.playCount,
    JSON.stringify(item.videoData || {})
  ].join(" ").toLowerCase().includes(needle));
}

export function filterPeerHitsByPlatform(items, platform = "all") {
  const wanted = normalizePeerHitPlatform(platform);
  const list = Array.isArray(items) ? items : [];
  if (!wanted) return list;
  return list.filter((item) => normalizePeerHitPlatform(item.platform) === wanted);
}

export function filterPeerHitsByTime(items, range = "all", now = Date.now(), since = 0) {
  const list = Array.isArray(items) ? items : [];
  const start = Number(since) > 0 ? Number(since) : rangeStart(range, now);
  if (!start) return list;
  return list.filter((item) => Number(item.importedAt || item.updatedAt || 0) >= start);
}

function rangeStart(range, now) {
  if (!range || range === "all") return 0;
  if (range === "today") {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  if (range === "7d") return now - 7 * 86_400_000;
  if (range === "30d") return now - 30 * 86_400_000;
  return 0;
}

export function importedPeerHitIdSet(scripts = []) {
  return new Set((Array.isArray(scripts) ? scripts : [])
    .filter((script) => String(script?.peerHitId || "").trim() && String(script?.audioId || script?.audio?.id || "").trim())
    .map((script) => String(script.peerHitId).trim()));
}

export function attachAudioBoardImportStatus(hit, importedIds = new Set()) {
  return {
    ...hit,
    importedToAudioBoard: importedIds.has(String(hit?.id || "").trim())
  };
}

export function planPeerHitNovelImports(hits, novels = [], { importedPeerHitIds } = {}) {
  const imported = importedPeerHitIds instanceof Set ? importedPeerHitIds : new Set();
  return (Array.isArray(hits) ? hits : []).map((hit) => {
    const label = hit?.novelTitle || hit?.novelId || "这条";
    if (!String(hit?.audioId || "").trim()) return { hit, novel: null, skipReason: `${label} 还没有爆款音频` };
    const novel = matchFactoryNovel(hit, novels);
    if (!novel) return { hit, novel: null, skipReason: `${label} 的小说id和平台对不上书单` };
    if (imported.has(String(hit?.id || "").trim())) return { hit, novel, skipReason: `${label} 已经写入音频页` };
    return { hit, novel, skipReason: "" };
  });
}

export function sortPeerHits(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const play = (Number(right.playCount) || 0) - (Number(left.playCount) || 0);
    if (play) return play;
    return (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0);
  });
}

function readVideoData(item) {
  let data = item.videoData ?? item.video_data ?? item["视频数据"] ?? {};
  if (typeof data === "string") {
    const text = data.trim();
    if (!text) data = {};
    else {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) data = { raw: String(data || "") };
  const extras = {};
  for (const [key, value] of Object.entries(item)) {
    if (TOP_KEYS.has(key) || value == null || typeof value === "object") continue;
    extras[key] = value;
  }
  return { ...extras, ...data };
}
