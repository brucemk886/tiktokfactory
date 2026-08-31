import fs from "node:fs";
import path from "node:path";
import { normalizeTtsProvider, resolveVoiceForProvider } from "./kokoro-voices.js";

export const SEED_VERSION_COUNT = 3;
const MIN_SCRIPT_CHARS = 20;
const MIN_SOURCE_CHARS = 80;

export function createNovelSeedService({
  workDir,
  novelContentLibrary,
  audioLibrary,
  marketingGenerator = null,
  defaultAudioDir = "",
  now = () => Date.now()
} = {}) {
  if (!workDir) throw new Error("Novel seed service requires a work directory.");
  if (!novelContentLibrary) throw new Error("Novel seed service requires a novel content library.");
  if (!audioLibrary) throw new Error("Novel seed service requires an audio library.");
  const settingsPath = path.join(workDir, "novel-seed-settings.json");
  const inFlight = new Map();

  function getSettings() {
    const stored = readJson(settingsPath);
    return normalizeSettings({
      voiceId: stored.voiceId,
      targetAudioDir: stored.targetAudioDir || resolveDefaultAudioDir(),
      autoSeedOnCreate: stored.autoSeedOnCreate,
      speechSpeed: stored.speechSpeed,
      ttsProvider: stored.ttsProvider
    });
  }

  function saveSettings(payload = {}) {
    const current = getSettings();
    const next = normalizeSettings({
      voiceId: payload.voiceId !== undefined ? payload.voiceId : current.voiceId,
      targetAudioDir: payload.targetAudioDir !== undefined ? payload.targetAudioDir : current.targetAudioDir,
      autoSeedOnCreate: payload.autoSeedOnCreate !== undefined ? payload.autoSeedOnCreate : current.autoSeedOnCreate,
      speechSpeed: payload.speechSpeed !== undefined ? payload.speechSpeed : current.speechSpeed,
      ttsProvider: payload.ttsProvider !== undefined ? payload.ttsProvider : current.ttsProvider
    });
    writeJson(settingsPath, next);
    return next;
  }

  async function seedNovel({ novelId, voiceId, targetAudioDir, count = SEED_VERSION_COUNT, ttsProvider } = {}) {
    const settings = getSettings();
    const provider = normalizeTtsProvider(ttsProvider || settings.ttsProvider);
    const resolvedVoiceId = resolveVoiceForProvider(provider, voiceId || settings.voiceId);
    const resolvedDir = String(targetAudioDir || settings.targetAudioDir || resolveDefaultAudioDir() || "").trim();
    const versionCount = clampCount(count);
    if (provider === "elevenlabs" && !resolvedVoiceId) throw statusError(400, "请先选择配音声音。");
    if (!resolvedDir) throw statusError(400, "请先选择种子音频保存目录。");

    const wanted = String(novelId || "").trim();
    if (!wanted) throw statusError(400, "缺少小说编号。");
    if (inFlight.has(wanted)) return inFlight.get(wanted);

    const operation = runSeed({
      novelId: wanted,
      voiceId: resolvedVoiceId,
      targetAudioDir: resolvedDir,
      count: versionCount,
      ttsProvider: provider
    });
    inFlight.set(wanted, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(wanted);
    }
  }

  async function runSeed({ novelId, voiceId, targetAudioDir, count, ttsProvider }) {
    const novel = novelContentLibrary.getNovel(novelId);
    let scripts = usableScripts(novel.scripts);
    let marketingId = "";
    if (scripts.length < count) {
      if (typeof marketingGenerator !== "function") {
        throw statusError(400, "开头版本不足 3 条，且营销生成未配置，无法自动补齐。");
      }
      if (String(novel.sourceContent || "").trim().length < MIN_SOURCE_CHARS) {
        throw statusError(400, "免费章节太短，无法自动生成 3 个开头版本。");
      }
      const record = await marketingGenerator({
        title: novel.title,
        category: novel.category,
        sourceText: novel.sourceContent,
        platform: novel.platform,
        promotionCode: novel.promotionCode,
        promotionCopy: novel.promotionCopy
      });
      marketingId = String(record?.id || "").trim();
      novelContentLibrary.importMarketingResult(record, {
        title: novel.title,
        category: novel.category,
        sourceText: novel.sourceContent,
        platform: novel.platform,
        promotionCode: novel.promotionCode,
        promotionCopy: novel.promotionCopy,
        featured: novel.featured
      });
      scripts = usableScripts(novelContentLibrary.getNovel(novelId).scripts);
    }
    if (scripts.length < count) {
      throw statusError(400, `自动生成后仍只有 ${scripts.length} 条可用开头，不足 ${count} 条。`);
    }

    const results = [];
    for (const script of pickSeedTargets(scripts, count)) {
      if (script.audioId && audioLibrary.get?.(script.audioId)) {
        results.push({ scriptId: script.id, audioId: script.audioId, skipped: true, cacheHit: true });
        continue;
      }
      const audio = await audioLibrary.generateFromScript({
        script: script.text,
        openingTitle: script.openingTitle || "",
        title: `${novel.title} ${script.versionLabel || script.title || "开头"}`,
        voiceId,
        targetAudioDir,
        novelId: novel.id,
        scriptId: script.id,
        sourceType: "novel-seed",
        ttsProvider
      });
      novelContentLibrary.attachScriptAudio(script.id, audio.id);
      results.push({
        scriptId: script.id,
        audioId: audio.id,
        skipped: false,
        cacheHit: Boolean(audio.cacheHit),
        targetAudioPath: audio.targetAudioPath || ""
      });
    }

    const refreshed = novelContentLibrary.getNovel(novelId);
    const audioCount = usableScripts(refreshed.scripts).filter((item) => item.audioId).length;
    return {
      novelId: novel.id,
      title: novel.title,
      voiceId,
      ttsProvider,
      targetAudioDir,
      marketingId,
      generatedAt: new Date(now()).toISOString(),
      generated: results,
      scriptCount: refreshed.scripts.length,
      audioCount,
      ready: audioCount >= count
    };
  }

  function resolveDefaultAudioDir() {
    try {
      return String(typeof defaultAudioDir === "function" ? defaultAudioDir() : defaultAudioDir || "").trim();
    } catch {
      return "";
    }
  }

  return { getSettings, saveSettings, seedNovel };
}

function usableScripts(scripts = []) {
  return (Array.isArray(scripts) ? scripts : []).filter((script) => String(script?.text || "").trim().length >= MIN_SCRIPT_CHARS);
}

function pickSeedTargets(scripts, count) {
  const withAudio = scripts.filter((script) => script.audioId);
  const withoutAudio = scripts.filter((script) => !script.audioId);
  return [...withAudio, ...withoutAudio].slice(0, count);
}

function normalizeSettings(value = {}) {
  const ttsProvider = normalizeTtsProvider(value.ttsProvider);
  return {
    voiceId: resolveVoiceForProvider(ttsProvider, value.voiceId),
    targetAudioDir: String(value.targetAudioDir || "").trim(),
    versionCount: SEED_VERSION_COUNT,
    autoSeedOnCreate: value.autoSeedOnCreate !== false,
    speechSpeed: clampSpeechSpeed(value.speechSpeed),
    ttsProvider
  };
}

function clampSpeechSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return 1;
  return Math.max(0.7, Math.min(1.2, Math.round(speed * 20) / 20));
}

function clampCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count)) return SEED_VERSION_COUNT;
  return Math.min(5, Math.max(1, count));
}

function readJson(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function statusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
