import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readNovelAudioMeta } from "./novel-audio-meta.js";

const APP_ICON_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "app-icons");

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
  "#relationshipstories",
  "#redditreadings",
  "#storiesfromreddit",
  "#askreddit",
  "#redditstorytime",
  "#fyp",
  "#foryou",
  "#booktok",
  "#novel",
  "#webnovel",
  "#readingtok",
  "#plottwist",
  "#drama",
  "#familydrama",
  "#revenge",
  "#cheatingstories",
  "#relationshipadvice",
  "#minutestory",
  "#shortstory"
]);

// Body templates. `{hook}` is the story's first line, `{promo}` the novel's
// promotion copy, `{title}` the humanized audio title. A template that needs a
// field the post does not have is skipped.
const CAPTION_TEMPLATES = Object.freeze([
  "{hook}",
  "{hook}\n\n{promo}",
  "{promo}\n\n{hook}",
  "{hook} 👀",
  "Part 1. {hook}",
  "Wait for the ending. {hook}",
  "{hook}\n\nFull story in the app 📖",
  "{hook}\n\nWould you have done the same?",
  "Storytime: {hook}",
  "{promo}",
  "{title}",
  "{title}\n\n{promo}"
]);

export function extractAudioCaptionText(audioName = "") {
  return humanizeAudioTitle(audioName);
}

export function pickVariedHashtags({ seed = "", platform = "", count = 0 } = {}) {
  const platformTag = novelPlatformHashtag(platform);
  const pool = STORY_HASHTAGS.filter((tag) => tag !== platformTag);
  let hash = hashSeed(seed || platformTag || "caption");
  const next = () => {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    return hash;
  };
  // 3–5 tags unless the caller pins a count.
  const wanted = Math.max(1, Math.min(6, Number(count) || 3 + (next() % 3)));
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = next() % (index + 1);
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return [platformTag, ...pool.slice(0, wanted)].filter(Boolean);
}

// Every post gets its own body template and hashtag set, chosen from `seed`
// (account + file), so fifty accounts posting the same story do not carry
// fifty identical descriptions.
export function buildTikTokCaption({
  openingTitle = "",
  promotionCopy = "",
  platform = "",
  audioTitle = "",
  hookLine = "",
  seed = ""
} = {}) {
  const promo = String(promotionCopy || "").replace(/\s+/g, " ").trim();
  const hook = String(hookLine || openingTitle || "").replace(/\s+/g, " ").trim();
  const title = String(extractAudioCaptionText(audioTitle) || "").replace(/\s+/g, " ").trim();
  const fields = { hook, promo, title };
  const usable = CAPTION_TEMPLATES.filter((template) => [...template.matchAll(/\{(\w+)\}/g)].every((match) => fields[match[1]]));
  const seedText = String(seed || "").trim() || `${hook || promo || title}:${audioTitle}`;
  const template = usable.length ? usable[hashSeed(`${seedText}:template`) % usable.length] : "";
  const body = template
    .replace(/\{(\w+)\}/g, (_, key) => fields[key] || "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  const tags = pickVariedHashtags({ seed: `${seedText}:tags`, platform }).join(" ");
  return [body, tags].filter(Boolean).join("\n\n").slice(0, 2200);
}

export function resolveTikTokCaption({
  workDir = "",
  video = {},
  fallback = {},
  captionMode = "",
  manualCaption = "",
  seed = ""
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
    hookLine: lookedUp.hookLine || "",
    audioTitle: video?.audioName || video?.title || "",
    seed: seed || `${video?.fileName || video?.audioName || ""}`
  });
  return generated || String(video?.videoDesc || "").trim().slice(0, 2200) || shared;
}

// The text that was actually sent to TTS for this audio (audio record first,
// then the library script it belongs to). Empty when the audio is not one we
// synthesized, e.g. an imported peer clip.
export function resolveNovelScriptText({ workDir, audioPath = "" } = {}) {
  if (!workDir) return "";
  const audioItems = readAudioIndex(workDir);
  const audio = matchAudioRecord(audioItems, audioPath, workDir);
  if (!audio) return "";
  const spoken = String(audio.script || "").trim();
  if (spoken) return spoken;
  const script = findScriptForAudio(readNovelStore(workDir), audio);
  if (!script?.text) return "";
  return buildSpokenNarration(script.speakOpeningTitle === true ? script.openingTitle : "", script.text);
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
  return sanitizeDrawtext(
    firstHookLine(audio?.script) || firstHookLine(script?.text) || firstHookLine(fallbackTitle)
  );
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
  const identity = resolveNovelIdentity({ workDir, audioPath, fallback });
  if (!identity.platform && !identity.promotionCode) return null;
  const displayPlatform = displayNovelPlatform(identity.platform);
  return {
    novelId: identity.novelId,
    platform: identity.platform,
    promotionCode: identity.promotionCode,
    promotionCopy: identity.promotionCopy,
    displayPlatform,
    lines: [identity.promotionCode, displayPlatform].filter(Boolean)
  };
}

export function resolveNovelEndCard({
  workDir,
  audioPath = "",
  fallback = {}
} = {}) {
  const identity = resolveNovelIdentity({ workDir, audioPath, fallback });
  if (!identity.promotionCode && !identity.platform) return null;
  return {
    novelId: identity.novelId,
    novelTitle: identity.novelTitle,
    platform: identity.platform,
    bookId: identity.bookId,
    promotionCode: identity.promotionCode,
    searchCode: identity.promotionCode,
    displayPlatform: displayNovelPlatform(identity.platform),
    icon: novelAppIconSpec(identity.platform)
  };
}

export function novelAppIconSpec(platform) {
  const key = String(platform || "").replace(/\s+/g, "");
  if (key === "GoodNovel") return { key: "goodnovel", fileName: "goodnovel.png", letter: "G", color: "0x1E9B6F", label: "GoodNovel" };
  if (key === "MotoNovel") return { key: "motonovel", fileName: "motonovel.png", letter: "M", color: "0xE23B6B", label: "MotoNovel" };
  return { key: "novelmaster", fileName: "novelmaster.png", letter: "M", color: "0xFF4B1F", label: "NovelMaster" };
}

export function resolveNovelAppIconFile(platform) {
  const spec = novelAppIconSpec(platform);
  const file = path.join(APP_ICON_DIR, spec.fileName);
  return fs.existsSync(file) ? file : "";
}

const END_CARD_MAX_LOOKBACK = 10;

export function endCardStartAt(duration, seconds = 3) {
  const total = Math.max(0, Number(duration) || 0);
  const hold = Math.min(Math.max(1.5, Number(seconds) || 3), total || 3);
  return Math.max(0, Number((total - hold).toFixed(2)));
}

export function isSpokenEndCardText(text) {
  const value = String(text || "").toLowerCase();
  return /\bsearch\b/.test(value)
    || /full story|whole story/.test(value)
    || (/\bapp\b/.test(value) && /\b(on|novel|goodnovel|motonovel|master)\b/.test(value));
}

export function resolveEndCardStart(duration, captions, fallbackSeconds = 3) {
  const fallback = endCardStartAt(duration, fallbackSeconds);
  const total = Math.max(0, Number(duration) || 0);
  if (!(total > 0)) return fallback;
  const earliest = Math.max(0, total - END_CARD_MAX_LOOKBACK);
  const fromWords = lastSearchWordStart(captions);
  if (fromWords >= earliest && fromWords < total) return Number(fromWords.toFixed(2));
  const fromCues = lastEndCardCueStart(captions);
  if (fromCues >= earliest && fromCues < total) return Number(fromCues.toFixed(2));
  return fallback;
}

function lastSearchWordStart(captions) {
  const words = Array.isArray(captions?.words) ? captions.words : [];
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const token = String(words[i]?.text || "").replace(/[^a-zA-Z]/g, "");
    if (/^search$/i.test(token) && Number.isFinite(Number(words[i].start))) {
      return Number(words[i].start);
    }
  }
  return Number.NaN;
}

function lastEndCardCueStart(captions) {
  const cues = Array.isArray(captions?.cues) ? captions.cues : [];
  let start = Number.NaN;
  for (let i = cues.length - 1; i >= 0; i -= 1) {
    if (!isSpokenEndCardText(cues[i]?.text)) break;
    const cueStart = Number(cues[i].start);
    if (Number.isFinite(cueStart)) start = cueStart;
  }
  return start;
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
  const searchCode = sanitizeDrawtext(card?.searchCode || card?.promotionCode || "");
  const platform = String(card?.platform || "");
  if (!searchCode && !platform) return [];
  const font = filterPath(fontFile || "C:/Windows/Fonts/msyhbd.ttc");
  const size = Math.max(48, Math.min(96, Number(fontSize) || 76));
  const enable = `gte(t,${Math.max(0, Number(startAt) || 0).toFixed(2)})`;
  const lineGap = Math.round(size * 1.22);
  const firstY = Math.round((Number(height) || 1920) * 0.42);
  const space = estimateDrawtextWidth(" ", size);
  const lines = [
    searchCode ? [
      { text: "Search", color: "0xF5E000" },
      { text: searchCode, color: "white" }
    ] : null,
    [
      { text: "On", color: "0x3DDC4A" },
      ...endCardNameParts(platform),
      { text: "app", color: "0x3DDC4A" }
    ].filter((part) => part.text),
    [{ text: "to read whole story", color: "0xF5E000" }]
  ].filter(Boolean);
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
  const official = resolveNovelAppIconFile(platform);
  if (official) {
    if (copyOfficialIcon(official, output) && fs.existsSync(output)) return output;
    fs.copyFileSync(official, output);
    return output;
  }
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

function copyOfficialIcon(source, destPath) {
  const size = 256;
  const radius = 48;
  const inner = size / 2 - radius;
  const alpha = `if(gt(abs(X-${size / 2}),${inner})*gt(abs(Y-${size / 2}),${inner})*gt(pow(abs(X-${size / 2})-${inner}\\,2)+pow(abs(Y-${size / 2})-${inner}\\,2),${radius * radius}),0,255)`;
  return runFfmpeg([
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", source,
    "-vf", `scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'`,
    "-frames:v", "1",
    destPath
  ]);
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

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function resolveNovelIdentity({ workDir, audioPath = "", fallback = {} } = {}) {
  const store = readNovelStore(workDir);
  const audioItems = readAudioIndex(workDir);
  const audio = matchAudioRecord(audioItems, audioPath, workDir);
  const novel = findNovelForAudio(store, audio) || findNovelById(store, fallback.novelId);
  const fileMeta = readNovelAudioMeta(audioPath);
  return {
    novel,
    audio,
    novelId: firstText(novel?.id, fileMeta.novelId, fallback.novelId),
    novelTitle: firstText(novel?.title, fileMeta.novelTitle, fallback.novelTitle),
    platform: firstText(novel?.platform, fileMeta.platform, fallback.platform, fallback.novelPlatform),
    promotionCode: firstText(novel?.promotionCode, fileMeta.promotionCode, fallback.promotionCode, fallback.novelPromotionCode),
    promotionCopy: firstText(novel?.promotionCopy, fileMeta.promotionCopy, fallback.promotionCopy),
    bookId: firstText(novel?.bookId, fileMeta.bookId, fallback.bookId, fallback.novelBookId)
  };
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
  return Math.max(1.2, Math.min(8, number));
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
  const words = sanitizeDrawtext(title).slice(0, 220).split(/\s+/).filter(Boolean);
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

export function fitOpeningTitle(title, { width = 1080, fontSize = 72, maxLines = 3, maxWidthRatio = 0.72, minSize = 36 } = {}) {
  const maxWidth = Math.max(240, Math.round((Number(width) || 1080) * (Number(maxWidthRatio) || 0.72)));
  const floor = Math.max(24, Number(minSize) || 36);
  let size = Math.max(floor, Math.min(96, Number(fontSize) || 72));
  let text = wrapTitleToWidth(title, maxWidth, size, maxLines);
  while (size > floor && text.split("\n").some((line) => estimateDrawtextWidth(line, size) > maxWidth)) {
    size -= 2;
    text = wrapTitleToWidth(title, maxWidth, size, maxLines);
  }
  return { text, fontSize: size };
}

export function wrapHookTitle(value, maxLine = 22) {
  const text = sanitizeDrawtext(value).slice(0, 220);
  if (!text) return "";
  return wrapTitleToWidth(text, Math.max(8, Number(maxLine) || 22) * 16, 28, 5);
}

export function firstHookLine(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const match = text.match(/^(.{8,220}?[.!?。！？])(?:\s|$)/);
  return (match?.[1] || text).slice(0, 220);
}

export function formatHookCardCode(code) {
  const value = sanitizeDrawtext(code).replace(/\s+/g, "");
  return value ? `code：${value}` : "";
}

export function renderRedditHookCard({
  title,
  destPath,
  fontFile,
  platform = "",
  promotionCode = ""
} = {}) {
  const output = String(destPath || "").trim();
  const hook = sanitizeDrawtext(title);
  if (!output || !hook) return "";
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const latinFont = pickExistingFont(fontFile, "C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/msyhbd.ttc");
  const displayName = displayNovelPlatform(platform) || "Novel Master";
  const codeLabel = formatHookCardCode(promotionCode);
  const logoPath = renderNovelAppIcon({
    platform,
    destPath: path.join(path.dirname(output), `hook-card-logo-${novelAppIconSpec(platform).key}.png`),
    fontFile: latinFont
  });
  const cardW = 920;
  const fitted = fitOpeningTitle(hook, { width: 820, fontSize: 40, maxLines: 5, maxWidthRatio: 1, minSize: 30 });
  const lines = fitted.text.split("\n").map((line) => line.trim()).filter(Boolean);
  const lineH = Math.round(fitted.fontSize * 1.28);
  const headerH = 76;
  const footerH = 52;
  const cardH = 20 + headerH + lines.length * lineH + footerH;
  const radius = 28;
  const shadowPad = 10;
  const canvasW = cardW + shadowPad * 2;
  const canvasH = cardH + shadowPad + 8;
  const ox = shadowPad;
  const oy = shadowPad;
  const titleY0 = oy + headerH + 8;
  const nameX = ox + 108;
  const nameSize = displayName.length > 28 ? 24 : 28;
  const draws = [
    `drawtext=fontfile='${filterPath(latinFont)}':text='${escapeDrawtext(displayName)}':fontsize=${nameSize}:fontcolor=0x1A1A1B:x=${nameX}:y=${oy + 38}:expansion=none`,
    ...(codeLabel ? [
      `drawtext=fontfile='${filterPath(latinFont)}':text='${escapeDrawtext(codeLabel)}':fontsize=24:fontcolor=0x787C7E:x=${ox + cardW - 36}-text_w:y=${oy + 42}:expansion=none`
    ] : []),
    ...lines.map((line, index) => (
      `drawtext=fontfile='${filterPath(latinFont)}':text='${escapeDrawtext(line)}':fontsize=${fitted.fontSize}:fontcolor=0x1A1A1B:x=${ox + 40}:y=${titleY0 + index * lineH}:expansion=none`
    )),
    `drawtext=fontfile='${filterPath(latinFont)}':text='99+':fontsize=22:fontcolor=0x787C7E:x=${ox + 72}:y=${oy + cardH - 40}:expansion=none`,
    `drawtext=fontfile='${filterPath(latinFont)}':text='99+':fontsize=22:fontcolor=0x787C7E:x=${ox + 196}:y=${oy + cardH - 40}:expansion=none`
  ];
  const cardAlpha = roundedRectAlpha(cardW, cardH, radius);
  const badgeAlpha = `if(gt(pow(X-11\\,2)+pow(Y-11\\,2),11*11),0,255)`;
  const inputs = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=black@0.0:s=${canvasW}x${canvasH}:d=1,format=rgba`,
    "-f", "lavfi", "-i", `color=c=black@0.20:s=${cardW}x${cardH}:d=1,format=rgba`,
    "-f", "lavfi", "-i", `color=c=white:s=${cardW}x${cardH}:d=1,format=rgba`
  ];
  let logoIndex = -1;
  if (logoPath) {
    inputs.push("-i", logoPath);
    logoIndex = 3;
  }
  const heartIndex = logoIndex >= 0 ? 4 : 3;
  const chatIndex = heartIndex + 1;
  inputs.push(
    "-f", "lavfi", "-i", "color=c=0xFF4500:s=22x22:d=1,format=rgba",
    "-f", "lavfi", "-i", "color=c=0x878A8C:s=22x22:d=1,format=rgba"
  );
  const chain = [
    `[1:v]geq=r='0':g='0':b='0':a='${cardAlpha.replace(",255)", ",90)")}'[shadow]`,
    `[2:v]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${cardAlpha}'[card]`,
    `[${heartIndex}:v]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${badgeAlpha}'[heart]`,
    `[${chatIndex}:v]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${badgeAlpha}'[chat]`,
    `[0:v][shadow]overlay=${ox + 4}:${oy + 6}[shade]`,
    `[shade][card]overlay=${ox}:${oy}[sheet]`
  ];
  let current = "sheet";
  if (logoIndex >= 0) {
    chain.push(`[${logoIndex}:v]scale=52:52:force_original_aspect_ratio=increase,crop=52:52,format=rgba[logo]`);
    chain.push(`[${current}][logo]overlay=${ox + 40}:${oy + 26}[headed]`);
    current = "headed";
  }
  chain.push(`[${current}]${draws.join(",")}[texted]`);
  chain.push(`[texted][heart]overlay=${ox + 42}:${oy + cardH - 42}[h1]`);
  chain.push(`[h1][chat]overlay=${ox + 166}:${oy + cardH - 42}`);
  const args = [
    ...inputs,
    "-filter_complex",
    chain.join(";"),
    "-frames:v", "1",
    output
  ];
  if (runFfmpeg(args) && fs.existsSync(output)) return output;
  return "";
}

export function fitHookCardName(value, maxChars = 36) {
  const text = sanitizeDrawtext(value).replace(/\s+/g, " ").trim();
  if (!text) return "Novel Master";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(8, maxChars - 1)).trim()}…`;
}

function pickExistingFont(...candidates) {
  for (const value of candidates) {
    const file = String(value || "").trim();
    if (file && fs.existsSync(file)) return file;
  }
  return "C:/Windows/Fonts/arial.ttf";
}

function roundedRectAlpha(width, height, radius) {
  const cx = width / 2;
  const cy = height / 2;
  const innerX = width / 2 - radius;
  const innerY = height / 2 - radius;
  return `if(gt(abs(X-${cx}),${innerX})*gt(abs(Y-${cy}),${innerY})*gt(pow(abs(X-${cx})-${innerX}\\,2)+pow(abs(Y-${cy})-${innerY}\\,2),${radius * radius}),0,255)`;
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
    hookLine: String(firstHookLine(audio?.script || script?.text) || "").trim(),
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
