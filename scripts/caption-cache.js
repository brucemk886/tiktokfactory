import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CAPTION_CACHE_PREFIX = "reddit-mix-caption-cache-v1";
export const CAPTION_STT_MODEL_ID = "scribe_v2";

export function captionCacheKey(audioBuffer, modelId = CAPTION_STT_MODEL_ID) {
  return crypto.createHash("sha256")
    .update(CAPTION_CACHE_PREFIX)
    .update("\0")
    .update(String(modelId || CAPTION_STT_MODEL_ID))
    .update("\0")
    .update(audioBuffer)
    .digest("hex");
}

export function captionCachePath(workDir, audioPath, modelId = CAPTION_STT_MODEL_ID) {
  const audioBuffer = fs.readFileSync(audioPath);
  return path.join(workDir, "caption-cache", `${captionCacheKey(audioBuffer, modelId)}.json`);
}

export function writeCaptionCache(workDir, audioPath, captions = {}) {
  const file = String(audioPath || "").trim();
  if (!file || !fs.existsSync(file)) return "";
  const words = normalizeCaptionWords(captions.words);
  const text = String(captions.text || words.map((item) => item.text).join(" ")).trim();
  const cues = Array.isArray(captions.cues) && captions.cues.length
    ? captions.cues
    : makeCaptionCues(words, text);
  if (!words.length && !cues.length) return "";
  const cachePath = captionCachePath(workDir, file);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify({
    provider: String(captions.provider || "kokoro"),
    model: String(captions.model || "kokoro"),
    text,
    cues,
    words,
    cachedAt: new Date().toISOString()
  }, null, 2), "utf8");
  fs.renameSync(tempPath, cachePath);
  return cachePath;
}

export function writeCaptionCacheForFiles(workDir, files, captions = {}) {
  const seen = new Set();
  for (const file of files || []) {
    const resolved = String(file || "").trim();
    if (!resolved || seen.has(resolved) || !fs.existsSync(resolved)) continue;
    seen.add(resolved);
    writeCaptionCache(workDir, resolved, captions);
  }
}

export function normalizeCaptionWords(words = []) {
  return (Array.isArray(words) ? words : [])
    .map((item) => ({
      text: cleanCaptionToken(item?.text || item?.word || ""),
      start: Number(item?.start ?? item?.start_ts ?? item?.start_time),
      end: Number(item?.end ?? item?.end_ts ?? item?.end_time)
    }))
    .filter((item) => item.text && /[\p{L}\p{N}]/u.test(item.text) && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= item.start)
    .sort((left, right) => left.start - right.start);
}

export function makeCaptionCues(words = [], fallbackText = "") {
  const normalized = normalizeCaptionWords(words);
  if (!normalized.length) {
    return String(fallbackText || "").trim() ? [{ start: 0, end: 3, text: String(fallbackText).trim() }] : [];
  }
  const cues = [];
  let current = null;
  for (const word of normalized) {
    if (!current) {
      current = { start: word.start, end: word.end, text: word.text };
      continue;
    }
    const nextText = `${current.text} ${word.text}`;
    const shouldBreak = Math.max(0, word.start - current.end) > 0.42
      || word.end - current.start > 2.35
      || nextText.length > 30
      || /[.!?。！？]$/.test(current.text);
    if (shouldBreak) {
      cues.push(current);
      current = { start: word.start, end: word.end, text: word.text };
    } else {
      current.text = nextText;
      current.end = word.end;
    }
  }
  if (current) cues.push(current);
  return cues.filter((cue) => cue.text && cue.end > cue.start);
}

function cleanCaptionToken(value) {
  return String(value || "").replace(/[{}]/g, "").trim();
}
