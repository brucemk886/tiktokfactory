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
  "source", "importedAt", "imported_at", "updatedAt", "updated_at", "createdAt", "created_at",
  "publishedAt", "published_at", "发布时间"
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

export function tiktokVideoIdFromUrl(url) {
  const text = String(url || "").trim();
  return text.match(/\/video\/(\d+)/)?.[1] || text.match(/[?&]video_id=(\d+)/)?.[1] || "";
}

export function publishedAtFromTikTokId(videoId) {
  const id = String(videoId || "").trim();
  if (!/^\d{15,}$/.test(id)) return 0;
  try {
    const ms = Number(BigInt(id) >> 32n) * 1000;
    if (!Number.isFinite(ms) || ms < Date.parse("2016-01-01") || ms > Date.now() + 86_400_000) return 0;
    return ms;
  } catch {
    return 0;
  }
}

export function parsePublishedAt(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return Math.round(value);
    if (value > 1e9) return Math.round(value * 1000);
    return 0;
  }
  const text = String(value).trim();
  if (!text) return 0;
  if (/^\d{10,13}$/.test(text)) return parsePublishedAt(Number(text));
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function peerHitPublishedAt(hit = {}) {
  const data = hit?.videoData && typeof hit.videoData === "object" ? hit.videoData : {};
  const recorded = parsePublishedAt(
    data.发布时间 || data.publishedAt || data.publishTime || data.publish_time
    || data.createTime || data.create_time || data.createdAt || data.created_at
    || hit.publishedAt || hit.published_at || hit["发布时间"]
    || hit.createTime || hit.create_time || hit.createdAt || hit.created_at
  );
  if (recorded) return recorded;
  return publishedAtFromTikTokId(tiktokVideoIdFromUrl(hit.videoUrl || hit.video_url));
}

export function withPersistedPublishedAt(hit = {}) {
  const publishedAt = peerHitPublishedAt(hit);
  const data = hit.videoData && typeof hit.videoData === "object" && !Array.isArray(hit.videoData)
    ? { ...hit.videoData }
    : {};
  if (!publishedAt) return { ...hit, videoData: data };
  if (parsePublishedAt(data.发布时间) === publishedAt) {
    return hit.publishedAt === publishedAt ? hit : { ...hit, publishedAt, videoData: data };
  }
  return { ...hit, publishedAt, videoData: { ...data, 发布时间: publishedAt } };
}

export function planPeerHitPublishedAtWrites(hits = []) {
  return (Array.isArray(hits) ? hits : []).map((hit) => {
    const next = withPersistedPublishedAt(hit);
    const before = parsePublishedAt(hit?.videoData?.发布时间);
    const after = parsePublishedAt(next.videoData?.发布时间);
    return { id: hit?.id || "", hit: next, publishedAt: after, changed: Boolean(after) && after !== before };
  }).filter((item) => item.changed);
}

export function attachPeerHitTimes(hits = []) {
  return (Array.isArray(hits) ? hits : []).map((hit) => withPersistedPublishedAt(hit));
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
  const videoData = withPersistedPublishedAt({
    ...item,
    videoUrl,
    videoData: readVideoData(item)
  }).videoData;
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
  if (!current) return withPersistedPublishedAt(incoming);
  const videoUrl = incoming.videoUrl || current.videoUrl;
  return withPersistedPublishedAt({
    ...current,
    videoUrl,
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
  });
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
    item.scaleRun ? "能跑量 同一音频 多条视频" : "",
    item.videoUrl,
    item.playCount,
    JSON.stringify(item.videoData || {}),
    ...(Array.isArray(item.scaleRun?.videos) ? item.scaleRun.videos.flatMap((video) => [video.videoUrl, video.playCount, video.publishedAt]) : [])
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

export function sourceFileToken(values = []) {
  const blob = (Array.isArray(values) ? values : [values]).map((value) => String(value || "")).join(" ");
  return blob.match(/(\d+_\d{8,})/)?.[1] || "";
}

export function importedPeerHitIdSet(scripts = []) {
  return new Set((Array.isArray(scripts) ? scripts : [])
    .filter((script) => String(script?.peerHitId || "").trim() && String(script?.audioId || script?.audio?.id || "").trim())
    .map((script) => String(script.peerHitId).trim()));
}

export function clipsAreNearDuplicate(left, right) {
  const sa = Number(left?.size || left?.audio?.size || left?.audioSize || 0);
  const sb = Number(right?.size || right?.audio?.size || right?.audioSize || 0);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  if (Math.abs(sa - sb) / Math.max(sa, sb) > 0.005) return false;
  const da = Number(left?.duration || left?.audio?.duration || 0);
  const db = Number(right?.duration || right?.audio?.duration || 0);
  if (da && db) return Math.abs(da - db) <= 0.5;
  return true;
}

function scaleBookKey(hit) {
  return String(hit?.factoryNovelId || "").trim()
    || [normalizePeerHitPlatform(hit?.platform), String(hit?.novelId || "").trim()].filter(Boolean).join("::")
    || String(hit?.novelTitle || "").trim().toLowerCase();
}

function clipOfHit(hit) {
  return { size: Number(hit?.audioSize) || 0, duration: Number(hit?.audioDuration) || 0 };
}

export function attachScaleRunMarks(hits = []) {
  const list = (Array.isArray(hits) ? hits : []).map((item) => ({ ...item }));
  const byBook = new Map();
  for (const hit of list) {
    const book = scaleBookKey(hit);
    if (!book || !String(hit.audioId || "").trim()) continue;
    if (!byBook.has(book)) byBook.set(book, []);
    byBook.get(book).push(hit);
  }
  for (const group of byBook.values()) {
    const used = new Set();
    for (let index = 0; index < group.length; index++) {
      if (used.has(group[index].id)) continue;
      const cluster = [group[index]];
      used.add(group[index].id);
      for (let next = index + 1; next < group.length; next++) {
        if (used.has(group[next].id)) continue;
        if (cluster.some((item) => clipsAreNearDuplicate(clipOfHit(item), clipOfHit(group[next])))) {
          cluster.push(group[next]);
          used.add(group[next].id);
        }
      }
      if (cluster.length < 2) continue;
      const scaleRun = {
        videoCount: cluster.length,
        playCount: cluster.reduce((sum, item) => sum + (Number(item.playCount) || 0), 0),
        videos: cluster.map((item) => ({
          id: item.id,
          videoUrl: item.videoUrl || "",
          playCount: Number(item.playCount) || 0,
          publishedAt: Number(item.publishedAt) || peerHitPublishedAt(item)
        })).sort((left, right) => (Number(right.playCount) || 0) - (Number(left.playCount) || 0))
      };
      for (const hit of cluster) hit.scaleRun = scaleRun;
    }
  }
  return list;
}

export function collapseScaleRunHits(hits = []) {
  const list = Array.isArray(hits) ? hits : [];
  const hiddenIds = new Set();
  const importedPrimaryIds = new Set();
  const seen = new Set();
  for (const hit of list) {
    const videos = Array.isArray(hit.scaleRun?.videos) ? hit.scaleRun.videos : [];
    if (videos.length < 2 || seen.has(hit.id)) continue;
    const members = videos.map((video) => list.find((item) => item.id === video.id)).filter(Boolean);
    for (const member of members) seen.add(member.id);
    if (members.length < 2) continue;
    const primary = [...members].sort((left, right) => {
      const play = (Number(right.playCount) || 0) - (Number(left.playCount) || 0);
      if (play) return play;
      return (Number(right.publishedAt) || 0) - (Number(left.publishedAt) || 0);
    })[0];
    for (const member of members) {
      if (member.id !== primary.id) hiddenIds.add(member.id);
    }
    if (members.some((item) => item.importedToAudioBoard)) importedPrimaryIds.add(primary.id);
  }
  return list.filter((hit) => !hiddenIds.has(hit.id)).map((hit) => (
    importedPrimaryIds.has(hit.id) && !hit.importedToAudioBoard
      ? { ...hit, importedToAudioBoard: true }
      : hit
  ));
}

export function scaleRunForScript(script, markedHits = []) {
  const peerId = String(script?.peerHitId || "").trim();
  const byPeer = (Array.isArray(markedHits) ? markedHits : []).find((hit) => hit.scaleRun && hit.id === peerId);
  if (byPeer) return byPeer.scaleRun;
  const clip = { size: Number(script?.audio?.size || 0), duration: Number(script?.audio?.duration || 0) };
  return (Array.isArray(markedHits) ? markedHits : []).find((hit) => hit.scaleRun && clipsAreNearDuplicate(clip, clipOfHit(hit)))?.scaleRun || null;
}

function scriptClip(script) {
  return {
    size: Number(script?.audio?.size || script?.audioSize || 0),
    duration: Number(script?.audio?.duration || script?.audioDuration || 0)
  };
}

function scaleRunKey(script) {
  const videos = Array.isArray(script?.scaleRun?.videos) ? script.scaleRun.videos : [];
  if (videos.length < 2) return "";
  return videos.map((video) => String(video.id || video.videoUrl || "")).filter(Boolean).sort().join("|");
}

function scriptTime(script) {
  const raw = script?.audio?.createdAt || script?.createdAt || 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scriptBetter(left, right) {
  const rank = (script) => [
    script?.mixEnabled === false ? 0 : 1,
    Number(script?.scaleRun?.playCount || script?.performance?.totalViews || 0),
    scriptTime(script)
  ];
  const a = rank(left);
  const b = rank(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}

export function collapseDuplicateAudioScripts(scripts = []) {
  const list = Array.isArray(scripts) ? scripts : [];
  const hidden = new Set();
  const used = new Set();
  for (let index = 0; index < list.length; index++) {
    const current = list[index];
    if (used.has(current.id)) continue;
    const cluster = [current];
    used.add(current.id);
    const key = scaleRunKey(current);
    for (let next = index + 1; next < list.length; next++) {
      const item = list[next];
      if (used.has(item.id)) continue;
      const sameScale = Boolean(key) && scaleRunKey(item) === key;
      const sameClip = cluster.some((member) => clipsAreNearDuplicate(scriptClip(member), scriptClip(item)));
      if (!sameScale && !sameClip) continue;
      cluster.push(item);
      used.add(item.id);
    }
    if (cluster.length < 2) continue;
    const keep = cluster.reduce((best, item) => (scriptBetter(item, best) ? item : best));
    for (const item of cluster) {
      if (item.id !== keep.id) hidden.add(item.id);
    }
  }
  return list.filter((script) => !hidden.has(script.id));
}

export function importedClipFingerprintsByNovel(scripts = []) {
  const map = new Map();
  for (const script of Array.isArray(scripts) ? scripts : []) {
    const novelId = String(script?.novelId || "").trim();
    const size = Number(script?.audio?.size || 0);
    if (!novelId || !size) continue;
    if (!map.has(novelId)) map.set(novelId, []);
    map.get(novelId).push({
      size,
      duration: Number(script?.audio?.duration || 0)
    });
  }
  return map;
}

export function importedSourceTokensByNovel(scripts = []) {
  const map = new Map();
  for (const script of Array.isArray(scripts) ? scripts : []) {
    const novelId = String(script?.novelId || "").trim();
    const token = sourceFileToken([
      script?.title,
      script?.openingTitle,
      script?.text,
      script?.audio?.fileName,
      script?.audio?.title
    ]);
    if (!novelId || !token) continue;
    if (!map.has(novelId)) map.set(novelId, new Set());
    map.get(novelId).add(token);
  }
  return map;
}

export function attachAudioBoardImportStatus(hit, importedIds = new Set()) {
  return {
    ...hit,
    importedToAudioBoard: importedIds.has(String(hit?.id || "").trim())
  };
}

export function planPeerHitNovelImports(hits, novels = [], {
  importedPeerHitIds,
  importedSourceTokensByNovel: tokensByNovel,
  importedClipFingerprintsByNovel: fingerprintsByNovel
} = {}) {
  const imported = importedPeerHitIds instanceof Set ? importedPeerHitIds : new Set();
  const tokens = tokensByNovel instanceof Map ? tokensByNovel : new Map();
  const fingerprints = fingerprintsByNovel instanceof Map ? fingerprintsByNovel : new Map();
  return (Array.isArray(hits) ? hits : []).map((hit) => {
    const label = hit?.novelTitle || hit?.novelId || "这条";
    if (!String(hit?.audioId || "").trim()) return { hit, novel: null, skipReason: `${label} 还没有爆款音频` };
    const novel = matchFactoryNovel(hit, novels);
    if (!novel) return { hit, novel: null, skipReason: `${label} 的小说id和平台对不上书单` };
    if (imported.has(String(hit?.id || "").trim())) return { hit, novel, skipReason: `${label} 已经写入音频页` };
    const token = sourceFileToken([hit.audioName, hit.novelTitle, hit.title]);
    if (token && tokens.get(novel.id)?.has(token)) return { hit, novel, skipReason: `${label} 已经写入音频页` };
    const incoming = { size: Number(hit.audioSize) || 0, duration: Number(hit.audioDuration) || 0 };
    if ((fingerprints.get(novel.id) || []).some((item) => clipsAreNearDuplicate(incoming, item))) {
      return { hit, novel, skipReason: `${label} 已经写入音频页` };
    }
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
