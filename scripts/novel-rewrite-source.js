import { isPlaceholderUploadedScript } from "./novel-audio-import.js";
import { uniqueNovelIds } from "./novel-batch-audio.js";
import { normalizeNarratorGender, normalizeTtsProvider, resolveVoiceForNarrator } from "./kokoro-voices.js";

export const PEER_REWRITE_MIN_CHARS = 80;
export const BATCH_REWRITE_MAX_NOVELS = 10;

export function uniqueRewriteNovelIds(value) {
  return uniqueNovelIds(value).slice(0, BATCH_REWRITE_MAX_NOVELS);
}

export function firstReadyPeerRewriteScript(novel) {
  return (Array.isArray(novel?.scripts) ? novel.scripts : []).find((script) => isReadyPeerRewriteScript(script)) || null;
}

export function isReadyPeerRewriteScript(script = {}) {
  if (String(script?.sourceType || "") !== "peer-hit") return false;
  const status = String(script.transcriptStatus || "").trim();
  if (status === "pending" || status === "running" || status === "failed") return false;
  if (status && status !== "ready") return false;
  const text = String(script.text || "").trim();
  if (!text || isPlaceholderUploadedScript(text)) return false;
  return text.length >= PEER_REWRITE_MIN_CHARS;
}

export function peerRewriteSourceError(script, sourceScriptId) {
  const id = String(sourceScriptId || "").trim();
  if (!id) {
    return Object.assign(new Error("请先勾选一条已识别完成的同行爆款口播，再生成改写。"), { statusCode: 400 });
  }
  if (!script) {
    return Object.assign(new Error("没有找到勾选的同行爆款口播。"), { statusCode: 400 });
  }
  if (String(script.sourceType || "") !== "peer-hit") {
    return Object.assign(new Error("只能对照同行爆款口播改写，请勾选上面的同行爆款音频。"), { statusCode: 400 });
  }
  const status = String(script.transcriptStatus || "").trim();
  if (status === "pending" || status === "running") {
    return Object.assign(new Error("这条同行口播还在识别中，等识别完成后再改写。"), { statusCode: 400 });
  }
  if (status === "failed") {
    return Object.assign(new Error("这条同行口播识别失败，请先点「重新识别」。"), { statusCode: 400 });
  }
  const text = String(script.text || "").trim();
  if (!text || isPlaceholderUploadedScript(text)) {
    return Object.assign(new Error("这条同行口播还没有识别出正文，请先点「重新识别」。"), { statusCode: 400 });
  }
  if (text.length < PEER_REWRITE_MIN_CHARS) {
    return Object.assign(new Error("勾选的同行口播太短，换一条已识别完成的再改写。"), { statusCode: 400 });
  }
  return null;
}

export function resolvePeerRewriteSource(novel, sourceScriptId) {
  const id = String(sourceScriptId || "").trim();
  const scripts = Array.isArray(novel?.scripts) ? novel.scripts : [];
  const script = scripts.find((item) => item.id === id) || null;
  const error = peerRewriteSourceError(script, id);
  if (error) throw error;
  return {
    sourceScriptId: script.id,
    parentScriptId: script.id,
    sourceKind: "peer-transcript",
    sourceText: String(script.text || "").trim(),
    sourceLabel: String(script.versionLabel || script.openingTitle || script.title || "同行爆款").trim()
  };
}

export function peerRewriteOpeningPayload(novel, body = {}) {
  let sourceScriptId = String(body.sourceScriptId || "").trim();
  if (!sourceScriptId && body.autoPickPeer) {
    sourceScriptId = firstReadyPeerRewriteScript(novel)?.id || "";
  }
  const source = resolvePeerRewriteSource(novel, sourceScriptId);
  const styles = Array.isArray(body.styles) ? body.styles : [];
  const narratorGender = normalizeNarratorGender(body.narratorGender);
  const ttsProvider = normalizeTtsProvider(body.ttsProvider);
  return {
    novelId: novel.id,
    title: novel.title,
    language: body.language || "English",
    sourceText: source.sourceText,
    sourceKind: source.sourceKind,
    sourceLabel: source.sourceLabel,
    sourceScriptId: source.sourceScriptId,
    parentScriptId: source.parentScriptId,
    category: novel.category || "",
    platform: novel.platform || "",
    promotionCode: novel.promotionCode || "",
    sellingPoint: novel.sellingPoint || "",
    baseOpening: "",
    styles,
    model: body.model || "",
    reasoningEffort: body.reasoningEffort || "",
    narratorGender,
    ttsProvider,
    autoKeep: body.autoKeep === true,
    autoVoice: body.autoVoice === true,
    voiceId: resolveVoiceForNarrator(ttsProvider, body.voiceId, narratorGender),
    speechSpeed: body.speechSpeed,
    speakOpeningTitle: body.speakOpeningTitle === true
  };
}

export function sourceScriptIdByNovel(items = []) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const novelId = String(item?.novelId || "").trim();
    const sourceScriptId = String(item?.sourceScriptId || "").trim();
    if (novelId && sourceScriptId) map.set(novelId, sourceScriptId);
  }
  return map;
}

export function resolveBatchPeerRewriteJobs(novelById, body = {}) {
  const novelIds = uniqueRewriteNovelIds(body.novelIds);
  const sourceByNovel = sourceScriptIdByNovel(body.items);
  const autoPick = body.autoPickPeer !== false;
  return novelIds.map((novelId) => {
    const novel = novelById instanceof Map ? novelById.get(novelId) : novelById?.[novelId];
    if (!novel) return { novelId, skipped: true, reason: "没有找到该小说。" };
    try {
      return {
        novelId,
        title: novel.title,
        skipped: false,
        payload: peerRewriteOpeningPayload(novel, {
          ...body,
          sourceScriptId: sourceByNovel.get(novelId) || "",
          autoPickPeer: autoPick
        })
      };
    } catch (error) {
      return { novelId, title: novel.title, skipped: true, reason: error.message || "这本还不能改写。" };
    }
  });
}
