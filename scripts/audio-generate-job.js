import fs from "node:fs";
import path from "node:path";
import { createAudioLibraryService } from "./audio-library.js";
import { findAudioInLibrary, resolveTargetAudioDir } from "./audio-library-groups.js";
import { novelAudioMetaFrom, writeNovelAudioMeta } from "./novel-audio-meta.js";
import { createNovelContentLibraryService } from "./novel-content-library.js";
import { readConfig } from "./video-core.js";

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
      const record = await generateOne(library, item, targetAudioDir, bootConfig, payload);
      stampNovelAudioMeta(record.targetAudioPath, targetAudioDir, item, payload);
      if (novels && item.scriptId && record.id) {
        try { novels.attachScriptAudio(item.scriptId, record.id); } catch {}
      }
      results.push(publicAudioResult(item, record, targetAudioDir));
    } catch (error) {
      failed.push({
        scriptId: String(item.scriptId || "").trim(),
        title: String(item.title || "").trim(),
        error: error.message || "生成失败"
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
    novelTitle: item.novelTitle || payload.novelTitle || item.title
  });
}

async function generateOne(library, item, targetAudioDir, config, payload = {}) {
  const existingPath = findExistingAudio(library, item, config);
  if (existingPath) {
    const copied = copyToTarget(existingPath, targetAudioDir, item.title || item.fileName || item.id || "audio", item.audioId || path.basename(existingPath, path.extname(existingPath)));
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
  const record = await library.generateFromScript({
    script: item.script || item.text,
    title: item.title,
    openingTitle: item.openingTitle,
    speakOpeningTitle: item.speakOpeningTitle,
    voiceId: String(item.voiceId || payload.voiceId || localSeedVoiceId(payload, config) || "").trim(),
    targetAudioDir,
    novelId: item.novelId,
    scriptId: item.scriptId,
    sourceType: item.sourceType,
    speechSpeed: item.speechSpeed
  });
  const sourcePath = library.resolveAudioPath?.(record.id) || record.targetAudioPath;
  if (sourcePath && fs.existsSync(sourcePath)) {
    record.targetAudioPath = copyToTarget(sourcePath, targetAudioDir, record.title || item.title || "audio", record.id);
  }
  return record;
}

function localSeedVoiceId(payload = {}, config = {}) {
  return String(payload.voiceId || config.elevenLabsVoiceId || "").trim();
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
    cacheHit: Boolean(record.cacheHit)
  };
}

function safeDisplayName(value) {
  return String(value || "audio").trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").slice(0, 80) || "audio";
}
