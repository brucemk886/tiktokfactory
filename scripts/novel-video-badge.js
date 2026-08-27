import { spawnSync } from "node:child_process";
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

export function novelPlatformHashtag(platform) {
  const value = String(platform || "").replace(/\s+/g, "").trim();
  return value ? `#${value}` : "";
}

const STORY_HASHTAGS = Object.freeze([
  "#reddit",
  "#redditstories",
  "#storytime",
  "#aita",
  "#tifu",
  "#truestory",
  "#storytok",
  "#dailystory",
  "#realtalk",
  "#relationshipstories"
]);

export function extractAudioCaptionText(audioName = "") {
  return humanizeAudioTitle(audioName);
}

export function pickVariedHashtags({ seed = "", platform = "", count = 3 } = {}) {
  const platformTag = novelPlatformHashtag(platform);
  const wanted = Math.max(1, Math.min(4, Number(count) || 3));
  const pool = STORY_HASHTAGS.filter((tag) => tag !== platformTag);
  let hash = hashSeed(seed || platformTag || "caption");
  for (let index = pool.length - 1; index > 0; index -= 1) {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    const swap = hash % (index + 1);
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return [platformTag, ...pool.slice(0, wanted)].filter(Boolean);
}

export function buildTikTokCaption({
  openingTitle = "",
  promotionCopy = "",
  platform = "",
  audioTitle = ""
} = {}) {
  const title = String(extractAudioCaptionText(audioTitle) || openingTitle || "").replace(/\s+/g, " ").trim();
  const promo = String(promotionCopy || "").trim();
  const tags = pickVariedHashtags({ seed: title || audioTitle, platform }).join(" ");
  return [title, promo, tags].filter(Boolean).join("\n\n").slice(0, 2200);
}

export function resolveTikTokCaption({
  workDir = "",
  video = {},
  fallback = {},
  captionMode = "",
  manualCaption = ""
} = {}) {
  const mode = String(captionMode || "").trim().toLowerCase();
  const shared = String(manualCaption || "").slice(0, 2200);
  if (mode === "manual") return shared;

  const lookedUp = workDir ? lookupCaptionFields(workDir, video, fallback) : {};
  const openingTitle = String(video?.openingTitle || lookedUp.openingTitle || "").trim();
  const promotionCopy = String(video?.promotionCopy || lookedUp.promotionCopy || fallback.promotionCopy || "").trim();
  const platform = String(video?.novelPlatform || video?.platform || lookedUp.platform || fallback.platform || "").trim();
  const generated = buildTikTokCaption({
    openingTitle,
    promotionCopy,
    platform,
    audioTitle: video?.audioName || video?.title || ""
  });
  return generated || String(video?.videoDesc || "").trim().slice(0, 2200) || shared;
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
    promotionCopy: String(novel?.promotionCopy || fallback.promotionCopy || "").trim(),
    displayPlatform,
    lines: [promotionCode, displayPlatform].filter(Boolean)
  };
}

export function resolveNovelEndCard({
  workDir,
  audioPath = "",
  fallback = {}
} = {}) {
  const store = readNovelStore(workDir);
  const audioItems = readAudioIndex(workDir);
  const audio = matchAudioRecord(audioItems, audioPath, workDir);
  const novel = findNovelForAudio(store, audio) || findNovelById(store, fallback.novelId);
  const platform = String(novel?.platform || fallback.platform || fallback.novelPlatform || "").trim();
  const bookId = String(novel?.bookId || fallback.bookId || fallback.novelBookId || "").trim();
  const promotionCode = String(novel?.promotionCode || fallback.promotionCode || fallback.novelPromotionCode || "").trim();
  const searchCode = bookId || promotionCode;
  if (!searchCode && !platform) return null;
  return {
    novelId: String(novel?.id || fallback.novelId || ""),
    novelTitle: String(novel?.title || fallback.novelTitle || "").trim(),
    platform,
    bookId,
    promotionCode,
    searchCode,
    displayPlatform: displayNovelPlatform(platform),
    icon: novelAppIconSpec(platform)
  };
}

export function novelAppIconSpec(platform) {
  const key = String(platform || "").replace(/\s+/g, "");
  if (key === "GoodNovel") return { key: "goodnovel", letter: "G", color: "0x1E9B6F", label: "GoodNovel" };
  if (key === "MotoNovel") return { key: "motonovel", letter: "M", color: "0xE23B6B", label: "MotoNovel" };
  return { key: "novelmaster", letter: "M", color: "0xFF4B1F", label: "NovelMaster" };
}

export function endCardStartAt(duration, seconds = 3) {
  const total = Math.max(0, Number(duration) || 0);
  const hold = Math.min(Math.max(1.5, Number(seconds) || 3), total || 3);
  return Math.max(0, Number((total - hold).toFixed(2)));
}

export function hideCaptionsAfter(captions, afterSeconds) {
  const after = Number(afterSeconds);
  if (!captions || !(after > 0)) return captions;
  const clip = (item) => {
    const start = Number(item?.start);
    const end = Number(item?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= after) return null;
    if (end <= after) return item;
    return { ...item, end: after };
  };
  return {
    ...captions,
    cues: Array.isArray(captions.cues) ? captions.cues.map(clip).filter(Boolean) : captions.cues,
    words: Array.isArray(captions.words) ? captions.words.map(clip).filter(Boolean) : captions.words
  };
}

export function endCardNameParts(platform) {
  const key = String(platform || "").replace(/\s+/g, "");
  if (key === "NovelMaster") {
    return [
      { text: "Novel", color: "white" },
      { text: "Master", color: "0x3DDC4A" }
    ];
  }
  return [{ text: displayNovelPlatform(platform) || "NovelMaster", color: "white" }];
}

export function buildNovelEndCardDrawtext({
  card,
  fontFile,
  startAt = 0,
  width = 1080,
  height = 1920,
  fontSize = 76
} = {}) {
  const searchCode = sanitizeDrawtext(card?.searchCode || card?.bookId || card?.promotionCode || "");
  const platform = String(card?.platform || "");
  if (!searchCode && !platform) return [];
  const font = filterPath(fontFile || "C:/Windows/Fonts/msyhbd.ttc");
  const size = Math.max(48, Math.min(96, Number(fontSize) || 76));
  const enable = `gte(t,${Math.max(0, Number(startAt) || 0).toFixed(2)})`;
  const lineGap = Math.round(size * 1.22);
  const firstY = Math.round((Number(height) || 1920) * 0.42);
  const space = estimateDrawtextWidth(" ", size);
  const lines = [
    [
      { text: "Search", color: "0xF5E000" },
      { text: searchCode, color: "white" }
    ].filter((part) => part.text),
    [
      { text: "On", color: "0x3DDC4A" },
      ...endCardNameParts(platform),
      { text: "app", color: "0x3DDC4A" }
    ].filter((part) => part.text),
    [{ text: "to read whole story", color: "0xF5E000" }]
  ];
  return lines.flatMap((parts, lineIndex) => {
    const total = parts.reduce((sum, part, index) => (
      sum + estimateDrawtextWidth(part.text, size) + (index < parts.length - 1 ? space : 0)
    ), 0);
    let cursor = Math.round(((Number(width) || 1080) - total) / 2);
    const y = firstY + lineIndex * lineGap;
    return parts.map((part, index) => {
      const filter = [
        `drawtext=fontfile='${font}'`,
        `text='${escapeDrawtext(part.text)}'`,
        "expansion=none",
        `x=${cursor}`,
        `y=${y}`,
        `fontsize=${size}`,
        `fontcolor=${part.color}`,
        "borderw=10",
        "bordercolor=black",
        `enable='${enable}'`
      ].join(":");
      cursor += Math.round(estimateDrawtextWidth(part.text, size) + (index < parts.length - 1 ? space : 0));
      return filter;
    });
  });
}

export function buildEndCardDimFilter(startAt = 0) {
  const start = Math.max(0, Number(startAt) || 0).toFixed(2);
  return `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.38:t=fill:enable='gte(t,${start})'`;
}

export function renderNovelAppIcon({ platform, destPath, fontFile } = {}) {
  const spec = novelAppIconSpec(platform);
  const output = String(destPath || "").trim();
  if (!output) return "";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const font = filterPath(fontFile || "C:/Windows/Fonts/arialbd.ttf");
  const size = 256;
  const radius = 40;
  const inner = size / 2 - radius;
  const alpha = `if(gt(abs(X-${size / 2}),${inner})*gt(abs(Y-${size / 2}),${inner})*gt(pow(abs(X-${size / 2})-${inner}\\,2)+pow(abs(Y-${size / 2})-${inner}\\,2),${radius * radius}),0,255)`;
  const draw = `drawtext=fontfile='${font}':text='${spec.letter}':fontsize=150:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`;
  const rounded = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi",
    "-i", `color=c=${spec.color}:s=${size}x${size}:d=1,format=rgba`,
    "-vf", `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}',${draw}`,
    "-frames:v", "1",
    output
  ];
  if (runFfmpeg(rounded) && fs.existsSync(output)) return output;
  const square = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi",
    "-i", `color=c=${spec.color}:s=${size}x${size}:d=1,format=rgba`,
    "-vf", draw,
    "-frames:v", "1",
    output
  ];
  if (runFfmpeg(square) && fs.existsSync(output)) return output;
  return "";
}

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", args, { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  return result.status === 0;
}

export function buildNovelBadgeDrawtext({ badge, fontFile, textFile, x = 110, y = 168, fontSize = 54, enable = "" } = {}) {
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
    "bordercolor=black",
    enable ? `enable='${enable}'` : ""
  ].filter(Boolean).join(":")).join(",");
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

function lookupCaptionFields(workDir, video = {}, fallback = {}) {
  const store = readNovelStore(workDir);
  const audioItems = readAudioIndex(workDir);
  const audio = matchAudioRecord(audioItems, video.audioPath || "", workDir)
    || matchAudioByName(audioItems, video.audioName);
  const script = findScriptForAudio(store, audio);
  const novel = findNovelForAudio(store, audio) || findNovelById(store, video.novelId || fallback.novelId);
  return {
    openingTitle: String(script?.openingTitle || firstHookLine(script?.text) || "").trim(),
    promotionCopy: String(novel?.promotionCopy || "").trim(),
    platform: String(novel?.platform || "").trim()
  };
}

function matchAudioByName(items, audioName) {
  const name = String(audioName || "").trim();
  if (!name) return null;
  return items.find((item) => {
    if (item.fileName && item.fileName === name) return true;
    if (item.id && name.includes(item.id)) return true;
    const targetName = item.targetAudioPath ? path.basename(item.targetAudioPath) : "";
    return Boolean(targetName && targetName === name);
  }) || null;
}

function stripAudioExtension(value) {
  return String(value || "").replace(/\.[a-z0-9]{2,5}$/i, "").trim();
}

function humanizeAudioTitle(value) {
  const raw = stripAudioExtension(path.basename(String(value || "")));
  if (!raw) return "";
  const afterId = raw.match(/_(\d{8,})_(.+)$/);
  const source = afterId ? afterId[2] : raw.replace(/^\[music\]/i, "");
  return source.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function hashSeed(value) {
  return [...String(value)].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 2166136261);
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
