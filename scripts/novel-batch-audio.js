import { AUTO_OPENING_STYLE_ID } from "./novel-opening-styles.js";
import { scriptHasAudio, scriptIsKept } from "./novel-overview.js";

export const DEFAULT_BATCH_AUDIO_VERSIONS = 3;
export const BATCH_AUDIO_MIN_SOURCE = 80;
export const BATCH_AUDIO_MAX_NOVELS = 40;

export function clampBatchAudioVersionCount(value) {
  const count = Math.floor(Number(value) || DEFAULT_BATCH_AUDIO_VERSIONS);
  return Math.min(5, Math.max(1, Number.isFinite(count) ? count : DEFAULT_BATCH_AUDIO_VERSIONS));
}

export function batchOpeningStyleIds(count = DEFAULT_BATCH_AUDIO_VERSIONS) {
  return Array.from({ length: clampBatchAudioVersionCount(count) }, () => AUTO_OPENING_STYLE_ID);
}

export function keptOrVoicedCount(scripts = []) {
  return (Array.isArray(scripts) ? scripts : []).filter((script) => scriptHasAudio(script) || scriptIsKept(script)).length;
}

export function remainingAudioVersionCount(scripts, wanted = DEFAULT_BATCH_AUDIO_VERSIONS) {
  return Math.max(0, clampBatchAudioVersionCount(wanted) - keptOrVoicedCount(scripts));
}

export function firstHookLine(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || "";
}

export function openingVariantScriptPayloads(novel, variants = [], extras = {}) {
  const title = String(novel?.title || "小说").trim() || "小说";
  return (Array.isArray(variants) ? variants : []).map((variant) => {
    const text = String(variant?.script || "").trim();
    if (text.length < 20) return null;
    return {
      title: `${title} ${variant.styleLabel || "AI 改版"}`.slice(0, 240),
      versionLabel: String(variant.styleLabel || "AI 改版").slice(0, 100),
      sourceType: "ai-style-rewrite",
      openingTitle: String(variant.openingTitle || firstHookLine(text)).trim().slice(0, 80),
      kept: true,
      speakOpeningTitle: extras.speakOpeningTitle === true,
      parentScriptId: String(extras.parentScriptId || "").trim(),
      text
    };
  }).filter(Boolean);
}

export function uniqueNovelIds(value) {
  const seen = new Set();
  const ids = [];
  for (const item of Array.isArray(value) ? value : []) {
    const id = String(item || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= BATCH_AUDIO_MAX_NOVELS) break;
  }
  return ids;
}
