import fs from "node:fs";
import path from "node:path";

const PLATFORM_LABELS = Object.freeze({
  GoodNovel: "GoodNovel",
  MotoNovel: "MotoNovel",
  NovelMaster: "Novel Master"
});

export function displayNovelPlatform(platform) {
  const value = String(platform || "").trim();
  return PLATFORM_LABELS[value] || value;
}

export function resolveOpeningHookTitle({
  workDir,
  audioPath = "",
  fallbackTitle = ""
} = {}) {
  const store = readNovelStore(workDir);
  const audioItems = readAudioIndex(workDir);
  const audio = matchAudioRecord(audioItems, audioPath, workDir);
  const script = findScriptForAudio(store, audio);
  return wrapHookTitle(script?.openingTitle || firstHookLine(script?.text) || fallbackTitle);
}

export function buildOpeningTitleDrawtext({
  title,
  fontFile,
  textFile,
  durationSeconds = 3,
  fontSize = 72
} = {}) {
  const text = wrapHookTitle(title);
  if (!text || !textFile) return "";
  fs.mkdirSync(path.dirname(textFile), { recursive: true });
  fs.writeFileSync(textFile, text, "utf8");
  const font = filterPath(fontFile || "C:/Windows/Fonts/msyhbd.ttc");
  const end = Math.max(1, Math.min(5, Number(durationSeconds) || 3));
  return [
    `drawtext=fontfile='${font}'`,
    `textfile='${filterPath(textFile)}'`,
    "reload=0",
    "x=(w-text_w)/2",
    "y=(h-text_h)/2",
    `fontsize=${Math.max(42, Math.min(110, Number(fontSize) || 72))}`,
    "fontcolor=white",
    "borderw=12",
    "bordercolor=black",
    "box=1",
    "boxcolor=black@0.45",
    "boxborderw=28",
    "line_spacing=18",
    `enable='lt(t,${end})'`
  ].join(":");
}

export function resolveNovelVideoBadge({
  workDir,
  audioPath = "",
  fallback = {}
} = {}) {
  const store = readNovelStore(workDir);
  const audioItems = readAudioIndex(workDir);
  const audio = matchAudioRecord(audioItems, audioPath, workDir);
  const novel = findNovelForAudio(store, audio) || findNovelById(store, fallback.novelId);
  const platform = String(novel?.platform || fallback.platform || fallback.novelPlatform || "").trim();
  const promotionCode = String(novel?.promotionCode || fallback.promotionCode || fallback.novelPromotionCode || "").trim();
  if (!platform && !promotionCode) return null;
  const displayPlatform = displayNovelPlatform(platform);
  return {
    novelId: String(novel?.id || fallback.novelId || ""),
    platform,
    promotionCode,
    displayPlatform,
    lines: [promotionCode, displayPlatform].filter(Boolean)
  };
}

export function buildNovelBadgeDrawtext({ badge, fontFile, textFile, x = 48, y = 72, fontSize = 54 } = {}) {
  const lines = Array.isArray(badge?.lines) ? badge.lines.map((line) => String(line || "").trim()).filter(Boolean) : [];
  if (!lines.length || !textFile) return "";
  fs.mkdirSync(path.dirname(textFile), { recursive: true });
  fs.writeFileSync(textFile, lines.join("\n"), "utf8");
  const font = filterPath(fontFile || "C:/Windows/Fonts/msyhbd.ttc");
  return [
    `drawtext=fontfile='${font}'`,
    `textfile='${filterPath(textFile)}'`,
    "reload=0",
    `x=${Math.max(16, Number(x) || 48)}`,
    `y=${Math.max(16, Number(y) || 72)}`,
    `fontsize=${Math.max(28, Math.min(96, Number(fontSize) || 54))}`,
    "fontcolor=white",
    "borderw=8",
    "bordercolor=black",
    "line_spacing=10"
  ].join(":");
}

function findScriptForAudio(store, audio) {
  if (!audio) return null;
  return (store.scripts || []).find((item) => {
    return item.audioId === audio.id
      || item.id === String(audio.source?.scriptId || "")
      || (audio.source?.marketingId && item.marketingId === audio.source.marketingId && Number(item.marketingRank) === Number(audio.source.rank));
  }) || null;
}

function findNovelForAudio(store, audio) {
  const script = findScriptForAudio(store, audio);
  return findNovelById(store, script?.novelId || audio?.source?.novelId);
}

export function wrapHookTitle(value, maxLine = 28) {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!text) return "";
  if (text.length <= maxLine) return text;
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLine && current) {
      lines.push(current);
      current = word;
    } else current = next;
    if (lines.length === 2) break;
  }
  if (current && lines.length < 2) lines.push(current);
  return lines.join("\n");
}

function firstHookLine(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const match = text.match(/^(.{8,72}?[.!?。！？])(?:\s|$)/);
  return (match?.[1] || text).slice(0, 72);
}

function findNovelById(store, novelId) {
  const id = String(novelId || "").trim();
  if (!id) return null;
  return (store.novels || []).find((item) => item.id === id) || null;
}

function matchAudioRecord(items, audioPath, workDir) {
  const resolved = safeResolve(audioPath);
  if (!resolved) return null;
  const baseName = path.basename(resolved);
  const filesDir = path.join(workDir, "audio-library", "files");
  return items.find((item) => {
    const candidates = [
      item.targetAudioPath,
      item.fileName ? path.join(filesDir, item.fileName) : "",
      item.fileName
    ].map(safeResolve).filter(Boolean);
    if (candidates.includes(resolved)) return true;
    if (item.id && baseName.includes(item.id)) return true;
    const targetName = item.targetAudioPath ? path.basename(item.targetAudioPath) : "";
    return Boolean(targetName && targetName === baseName);
  }) || null;
}

function readNovelStore(workDir) {
  return readJson(path.join(workDir, "novel-content-library.json"), { novels: [], scripts: [] });
}

function readAudioIndex(workDir) {
  const value = readJson(path.join(workDir, "audio-library", "index.json"), []);
  return Array.isArray(value) ? value : [];
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeResolve(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return path.resolve(text);
  } catch {
    return "";
  }
}

function filterPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/:/g, "\\:");
}
