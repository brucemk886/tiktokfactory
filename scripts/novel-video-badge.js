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
  return sanitizeDrawtext(script?.openingTitle || firstHookLine(script?.text) || fallbackTitle).slice(0, 80);
}

export function buildOpeningTitleDrawtext({
  title,
  fontFile,
  textFile,
  durationSeconds = 3,
  fontSize = 72,
  width = 1080
} = {}) {
  const fitted = fitOpeningTitle(title, { width, fontSize });
  const lines = fitted.text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "";
  writeDrawtextFile(textFile, lines.join("\n"));
  const font = filterPath(fontFile || "C:/Windows/Fonts/msyhbd.ttc");
  const end = Math.max(1.2, Math.min(6, Number(durationSeconds) || 3));
  const lineHeight = Math.round(fitted.fontSize * 1.38);
  const offset = Math.round((lines.length - 1) * lineHeight / 2);
  return lines.map((line, index) => {
    const yShift = index * lineHeight - offset;
    const y = yShift === 0 ? "(h-text_h)/2" : `(h-text_h)/2${yShift > 0 ? `+${yShift}` : yShift}`;
    return [
    `drawtext=fontfile='${font}'`,
    `text='${escapeDrawtext(line)}'`,
    "expansion=none",
    "x=(w-text_w)/2",
    `y=${y}`,
    `fontsize=${fitted.fontSize}`,
    "fontcolor=white",
    "borderw=10",
    "bordercolor=black",
    "box=1",
    "boxcolor=black@0.45",
    "boxborderw=22",
    `enable='lt(t,${end})'`
    ].join(":");
  }).join(",");
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

export function buildNovelBadgeDrawtext({ badge, fontFile, textFile, x = 110, y = 168, fontSize = 54 } = {}) {
  const lines = Array.isArray(badge?.lines) ? badge.lines.map((line) => sanitizeDrawtext(line)).filter(Boolean) : [];
  if (!lines.length) return "";
  writeDrawtextFile(textFile, lines.join("\n"));
  const font = filterPath(fontFile || "C:/Windows/Fonts/msyhbd.ttc");
  const left = Math.max(16, Number(x) || 110);
  const top = Math.max(16, Number(y) || 168);
  const size = Math.max(28, Math.min(96, Number(fontSize) || 54));
  const gap = Math.round(size * 1.28);
  return lines.map((line, index) => [
    `drawtext=fontfile='${font}'`,
    `text='${escapeDrawtext(line)}'`,
    "expansion=none",
    `x=${left}`,
    `y=${top + index * gap}`,
    `fontsize=${size}`,
    "fontcolor=white",
    "borderw=8",
    "bordercolor=black"
  ].join(":")).join(",");
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

export function buildSpokenNarration(openingTitle, script) {
  const body = String(script || "").replace(/\s+/g, " ").trim();
  const title = String(openingTitle || "").replace(/\s+/g, " ").trim();
  if (!title) return body;
  if (body.toLowerCase().startsWith(title.toLowerCase())) return body;
  return `${title} ${body}`;
}

export function resolveOpeningTitleDuration(title, captions, fallbackSeconds = 3) {
  const words = tokenizeTitle(title);
  const fallback = clampTitleSeconds(fallbackSeconds, 3);
  if (!words.length) return fallback;
  const captionWords = Array.isArray(captions?.words) ? captions.words : [];
  let matched = 0;
  let end = 0;
  for (const word of captionWords) {
    const token = tokenizeTitle(word.text)[0];
    if (!token) continue;
    if (tokensMatch(token, words[matched])) {
      matched += 1;
      end = Number(word.end) || end;
      if (matched >= words.length) return clampTitleSeconds(end + 0.12, fallback);
      continue;
    }
    if (matched > 0) break;
  }
  return fallback;
}

export function hideCaptionsUntil(captions, untilSeconds) {
  const until = Number(untilSeconds);
  if (!captions || !(until > 0)) return captions;
  const clip = (item) => {
    const start = Number(item?.start);
    const end = Number(item?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= until) return null;
    if (start >= until) return item;
    return { ...item, start: until };
  };
  return {
    ...captions,
    cues: Array.isArray(captions.cues) ? captions.cues.map(clip).filter(Boolean) : captions.cues,
    words: Array.isArray(captions.words) ? captions.words.map(clip).filter(Boolean) : captions.words
  };
}

function tokenizeTitle(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function tokensMatch(left, right) {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function clampTitleSeconds(value, fallback = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1.2, Math.min(6, number));
}

export function estimateDrawtextWidth(text, fontSize) {
  const size = Math.max(1, Number(fontSize) || 72);
  let width = 0;
  for (const char of String(text || "")) {
    if (char === "\n") continue;
    if (char === " ") width += size * 0.34;
    else if (/[\u4e00-\u9fff]/.test(char)) width += size * 1.05;
    else if (/[A-ZMW]/.test(char)) width += size * 0.78;
    else width += size * 0.66;
  }
  return width;
}

export function wrapTitleToWidth(title, maxWidth, fontSize, maxLines = 3) {
  const words = sanitizeDrawtext(title).slice(0, 80).split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const limit = Math.max(120, Number(maxWidth) || 0);
  const size = Math.max(1, Number(fontSize) || 72);
  const lines = [];
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = current ? `${current} ${word}` : word;
    if (current && estimateDrawtextWidth(next, size) > limit) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) {
        current = [word, ...words.slice(index + 1)].join(" ");
        break;
      }
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines).join("\n");
}

export function fitOpeningTitle(title, { width = 1080, fontSize = 72 } = {}) {
  const maxWidth = Math.max(240, Math.round((Number(width) || 1080) * 0.72));
  let size = Math.max(36, Math.min(96, Number(fontSize) || 72));
  let text = wrapTitleToWidth(title, maxWidth, size);
  while (size > 36 && text.split("\n").some((line) => estimateDrawtextWidth(line, size) > maxWidth)) {
    size -= 4;
    text = wrapTitleToWidth(title, maxWidth, size);
  }
  return { text, fontSize: size };
}

export function wrapHookTitle(value, maxLine = 22) {
  const text = sanitizeDrawtext(value).slice(0, 80);
  if (!text) return "";
  return wrapTitleToWidth(text, Math.max(8, Number(maxLine) || 22) * 16, 28);
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

function writeDrawtextFile(textFile, text) {
  if (!textFile) return;
  fs.mkdirSync(path.dirname(textFile), { recursive: true });
  fs.writeFileSync(textFile, sanitizeDrawtext(text), "utf8");
}

function sanitizeDrawtext(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n+$/g, "")
    .trim();
}

function escapeDrawtext(value) {
  return sanitizeDrawtext(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/\n/g, "\\n");
}

function filterPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/:/g, "\\:");
}
