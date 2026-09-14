import fs from "node:fs";
import path from "node:path";
import { createAudioLibraryService, normalizeSpeechSpeed } from "./audio-library.js";
import { findAudioInLibrary, resolveTargetAudioDir } from "./audio-library-groups.js";
import { writeCaptionCacheForFiles } from "./caption-cache.js";
import { normalizeTtsProvider, resolveVoiceForProvider } from "./kokoro-voices.js";
import { novelAudioMetaFrom, writeNovelAudioMeta } from "./novel-audio-meta.js";
import { createNovelContentLibraryService } from "./novel-content-library.js";
import { readConfig } from "./video-core.js";

export const LONGFORM_AUDIO_LABEL = "3-5分钟版";
export const LONGFORM_AUDIO_MIN_SECONDS = 180;
export const LONGFORM_AUDIO_MAX_SECONDS = 300;
export const LONGFORM_AUDIO_MAX_REGENERATIONS = 2;

export async function runAudioGenerateJob({
  root = process.cwd(),
  workDir,
  config = null,
  payload = {},
  onProgress = null,
  audioLibrary = null,
  novelContentLibrary = null
} = {}) {
  const bootConfig = config || readConfig(root);
  const library = audioLibrary || createAudioLibraryService({ root, workDir, readConfig: () => bootConfig });
  const novels = novelContentLibrary || (workDir ? createNovelContentLibraryService({ workDir, audioLibrary: library }) : null);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw Object.assign(new Error("没有可下发的改写文案。"), { statusCode: 400 });
  const results = [];
  const failed = [];
  let lastDir = "";
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const targetAudioDir = resolveItemAudioDir(bootConfig, payload, item);
    lastDir = targetAudioDir;
    onProgress?.({
      current: index,
      total: items.length,
      percent: Math.max(4, Math.round((index / items.length) * 90)),
      message: `正在生成第 ${index + 1}/${items.length} 条到 ${path.basename(targetAudioDir)}...`
    });
    try {
      const record = await generateOneWithQuality(library, item, targetAudioDir, bootConfig, payload, workDir);
      stampNovelAudioMeta(record.targetAudioPath, targetAudioDir, item, payload);
      if (novels && item.scriptId && record.id) {
        try { novels.attachScriptAudio(item.scriptId, record.id); } catch {}
      }
      results.push(publicAudioResult(item, record, targetAudioDir));
    } catch (error) {
      failed.push({
        scriptId: String(item.scriptId || "").trim(),
        title: String(item.title || "").trim(),
        error: error.message || "生成失败",
        qualityAudit: error.qualityAudit || null
      });
    }
  }
  if (!results.length) {
    throw Object.assign(new Error(failed[0]?.error || "音频都没有生成成功。"), { statusCode: 502 });
  }
  return {
    targetAudioDir: lastDir,
    items: results,
    failed,
    progressCurrent: results.length,
    progressTotal: items.length
  };
}

export function resolveItemAudioDir(config, payload = {}, item = {}) {
  return resolveTargetAudioDir(config, payload.targetAudioDir, {
    novelTitle: item.novelTitle || payload.novelTitle || item.title,
    platform: item.platform || payload.platform
  });
}

async function generateOneWithQuality(library, item, targetAudioDir, config, payload = {}, workDir = "") {
  if (!isLongformAudioItem(item)) return generateOne(library, item, targetAudioDir, config, payload, workDir);
  const attempts = [];
  let speed = normalizeSpeechSpeed(item.speechSpeed ?? payload.speechSpeed);
  let lastError = null;
  for (let attempt = 0; attempt <= LONGFORM_AUDIO_MAX_REGENERATIONS; attempt += 1) {
    try {
      const tunedItem = { ...item, speechSpeed: speed };
      const record = await generateOne(library, tunedItem, targetAudioDir, config, { ...payload, speechSpeed: speed }, workDir);
      const audit = auditLongformAudioRecord(record, { speed, attempt });
      attempts.push({ ...audit, audioId: record.id || "" });
      if (audit.passed) {
        cleanupSupersededTargetCopies(attempts, record.targetAudioPath, targetAudioDir);
        return {
          ...record,
          qualityAudit: {
            passed: true,
            regenerationCount: attempt,
            maxRegenerations: LONGFORM_AUDIO_MAX_REGENERATIONS,
            attempts
          }
        };
      }
      lastError = new Error(audit.issue);
      speed = nextDurationTuningSpeed(speed, audit.duration);
    } catch (error) {
      lastError = error;
      attempts.push({ passed: false, duration: 0, speed, issue: String(error?.message || error) });
    }
  }
  cleanupSupersededTargetCopies(attempts, "", targetAudioDir);
  const error = new Error(`3–5 分钟音频最多重生成 ${LONGFORM_AUDIO_MAX_REGENERATIONS} 次后仍未达标：${lastError?.message || "未知问题"}`);
  error.code = "AUDIO_QUALITY_REJECTED";
  error.qualityAudit = { passed: false, maxRegenerations: LONGFORM_AUDIO_MAX_REGENERATIONS, attempts };
  throw error;
}

export function isLongformAudioItem(item = {}) {
  return String(item.title || item.versionLabel || "").includes(LONGFORM_AUDIO_LABEL);
}

export function auditLongformAudioRecord(record = {}, { speed = 1, attempt = 0 } = {}) {
  const duration = Math.max(0, Number(record.duration) || 0);
  const size = Math.max(0, Number(record.size) || 0);
  let issue = "";
  if (!duration) issue = "音频无法解码或没有有效时长";
  else if (duration < LONGFORM_AUDIO_MIN_SECONDS) issue = `实际 ${duration.toFixed(1)} 秒，短于 3 分钟`;
  else if (duration > LONGFORM_AUDIO_MAX_SECONDS) issue = `实际 ${duration.toFixed(1)} 秒，长于 5 分钟`;
  else if (size < 32_000) issue = `音频文件只有 ${size} 字节，疑似不完整`;
  return {
    passed: !issue,
    duration,
    size,
    speed: normalizeSpeechSpeed(speed),
    attempt: Number(attempt) || 0,
    targetSeconds: { min: LONGFORM_AUDIO_MIN_SECONDS, max: LONGFORM_AUDIO_MAX_SECONDS },
    issue
  };
}

function nextDurationTuningSpeed(currentSpeed, duration) {
  const current = normalizeSpeechSpeed(currentSpeed);
  const target = duration < LONGFORM_AUDIO_MIN_SECONDS ? 215 : 270;
  return normalizeSpeechSpeed(current * Math.max(1, Number(duration) || target) / target);
}

function cleanupSupersededTargetCopies(attempts, keepPath, targetAudioDir) {
  if (!String(targetAudioDir || "").trim()) return;
  const root = path.resolve(String(targetAudioDir || ""));
  const keep = keepPath ? path.resolve(keepPath) : "";
  for (const attempt of attempts) {
    const audioId = String(attempt.audioId || "").trim();
    if (!audioId) continue;
    const matches = fs.existsSync(root)
      ? fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.includes(audioId.slice(-12)))
      : [];
    for (const entry of matches) {
      const candidate = path.resolve(root, entry.name);
      const relative = path.relative(root, candidate);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || candidate === keep) continue;
      try { fs.rmSync(candidate, { force: true }); } catch {}
    }
  }
}
async function generateOne(library, item, targetAudioDir, config, payload = {}, workDir = "") {
  const existingPath = findExistingAudio(library, item, config);
  if (existingPath) {
    const copied = copyToTarget(existingPath, targetAudioDir, item.title || item.fileName || item.id || "audio", item.audioId || path.basename(existingPath, path.extname(existingPath)));
    writeImportedTranscriptCache(workDir, item, copied);
    const current = item.audioId ? library.get?.(item.audioId) : null;
    return {
      ...(current || {}),
      id: current?.id || item.audioId || path.basename(existingPath, path.extname(existingPath)),
      fileName: current?.fileName || path.basename(existingPath),
      title: current?.title || item.title || "",
      targetAudioPath: copied,
      cacheHit: true
    };
  }
  const ttsProvider = normalizeTtsProvider(item.ttsProvider || payload.ttsProvider);
  const record = await library.generateFromScript({
    script: item.script || item.text,
    title: item.title,
    openingTitle: item.openingTitle,
    speakOpeningTitle: item.speakOpeningTitle,
    voiceId: resolveVoiceForProvider(ttsProvider, item.voiceId || payload.voiceId || localSeedVoiceId(payload, config, ttsProvider)),
    targetAudioDir,
    novelId: item.novelId,
    scriptId: item.scriptId,
    sourceType: item.sourceType,
    speechSpeed: item.speechSpeed ?? payload.speechSpeed,
    ttsProvider
  });
  const sourcePath = library.resolveAudioPath?.(record.id) || record.targetAudioPath;
  if (sourcePath && fs.existsSync(sourcePath)) {
    record.targetAudioPath = copyToTarget(sourcePath, targetAudioDir, record.title || item.title || "audio", record.id);
  }
  return record;
}

function writeImportedTranscriptCache(workDir, item, audioPath) {
  if (!workDir || !audioPath || !Array.isArray(item?.words) || !item.words.length) return;
  writeCaptionCacheForFiles(workDir, [audioPath], {
    provider: "elevenlabs",
    model: "scribe_v2",
    text: item.script || item.text || "",
    words: item.words
  });
}

function localSeedVoiceId(payload = {}, config = {}, ttsProvider = "kokoro") {
  if (normalizeTtsProvider(ttsProvider) === "elevenlabs") {
    return String(payload.voiceId || config.elevenLabsVoiceId || "").trim();
  }
  return resolveVoiceForProvider("kokoro", payload.voiceId);
}

function findExistingAudio(library, item, config) {
  const hints = [item.targetAudioPath, item.fileName, item.audioId, item.id];
  for (const hint of hints) {
    const value = String(hint || "").trim();
    if (value && fs.existsSync(value) && fs.statSync(value).isFile()) return value;
  }
  if (item.audioId && typeof library.resolveAudioPath === "function") {
    const local = library.resolveAudioPath(item.audioId);
    if (local && fs.existsSync(local)) return local;
  }
  return findAudioInLibrary(hints, config);
}

function copyToTarget(sourcePath, targetAudioDir, title, id) {
  fs.mkdirSync(targetAudioDir, { recursive: true });
  const dest = path.join(targetAudioDir, `${safeDisplayName(title)}-${String(id || "audio").slice(-12)}.mp3`);
  if (path.resolve(sourcePath) !== path.resolve(dest)) fs.copyFileSync(sourcePath, dest);
  return dest;
}

function stampNovelAudioMeta(audioPath, targetAudioDir, item, payload) {
  writeNovelAudioMeta({
    dir: targetAudioDir || (audioPath ? path.dirname(audioPath) : ""),
    audioPath,
    novel: novelAudioMetaFrom(item, payload)
  });
}

function publicAudioResult(item, record, targetAudioDir) {
  return {
    scriptId: String(item.scriptId || "").trim(),
    novelId: String(item.novelId || record.source?.novelId || "").trim(),
    audioId: record.id || "",
    fileName: record.fileName || "",
    title: record.title || item.title || "",
    targetAudioPath: record.targetAudioPath || targetAudioDir,
    duration: Number(record.duration) || 0,
    size: Number(record.size) || 0,
    createdAt: record.createdAt || new Date().toISOString(),
    cacheHit: Boolean(record.cacheHit),
    qualityAudit: record.qualityAudit || null
  };
}

function safeDisplayName(value) {
  return String(value || "audio").trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").slice(0, 80) || "audio";
}
