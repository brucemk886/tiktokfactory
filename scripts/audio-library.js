import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listElevenLabsVoices, NOVEL_TTS_MODEL_ID, NOVEL_TTS_MODEL_NAME } from "./elevenlabs-voices.js";
import { buildSpokenNarration } from "./novel-video-badge.js";

export { NOVEL_TTS_MODEL_ID, NOVEL_TTS_MODEL_NAME };
export const DEFAULT_SPEECH_SPEED = 1;
export const MIN_SPEECH_SPEED = 0.7;
export const MAX_SPEECH_SPEED = 1.2;
export const MIN_RETUNE_SPEED = 0.8;
export const MAX_RETUNE_SPEED = 1.4;

export function normalizeSpeechSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return DEFAULT_SPEECH_SPEED;
  return Math.max(MIN_SPEECH_SPEED, Math.min(MAX_SPEECH_SPEED, Math.round(speed * 20) / 20));
}

export function normalizeRetuneSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return DEFAULT_SPEECH_SPEED;
  return Math.max(MIN_RETUNE_SPEED, Math.min(MAX_RETUNE_SPEED, Math.round(speed * 20) / 20));
}

export function createAudioLibraryService({ root, workDir, readConfig, fetchImpl = globalThis.fetch, getDefaultVoiceId = null }) {
  const libraryDir = path.join(workDir, "audio-library");
  const filesDir = path.join(libraryDir, "files");
  const indexPath = path.join(libraryDir, "index.json");
  const inFlight = new Map();
  fs.mkdirSync(filesDir, { recursive: true });

  function list() {
    return readIndex(indexPath)
      .filter((item) => fs.existsSync(path.join(filesDir, item.fileName)))
      .map(enrichRecord)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  function enrichRecord(item) {
    if (String(item?.script || "").trim()) return item;
    const marketingId = safeStem(item?.source?.marketingId);
    const rank = Number(item?.source?.rank) || 0;
    if (!marketingId || !rank) return item;
    try {
      const marketingPath = path.join(workDir, "novel-marketing", `${marketingId}.json`);
      const source = JSON.parse(fs.readFileSync(marketingPath, "utf8"));
      const selected = source?.marketing?.selected?.find((entry) => Number(entry.rank) === rank);
      return { ...item, script: String(selected?.script || "").trim() };
    } catch {
      return item;
    }
  }

  function get(id) {
    const safeId = safeStem(id);
    return list().find((item) => item.id === safeId) || null;
  }

  function resolveAudioPath(id) {
    const item = get(id);
    if (!item) return "";
    const candidate = path.resolve(filesDir, item.fileName);
    if (!candidate.startsWith(path.resolve(filesDir) + path.sep)) return "";
    return fs.existsSync(candidate) ? candidate : "";
  }

  function prepareTaskBatch(ids) {
    const selected = Array.from(new Set(Array.isArray(ids) ? ids.map((id) => safeStem(id)).filter(Boolean) : []))
      .map((id) => get(id))
      .filter(Boolean);
    if (!selected.length) throw httpError(400, "请至少勾选一条音频。");
    const batchId = `audio-batch-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
    const batchDir = path.join(libraryDir, "task-batches", batchId);
    fs.mkdirSync(batchDir, { recursive: true });
    const manifest = [];
    selected.forEach((item, index) => {
      const sourcePath = resolveAudioPath(item.id);
      if (!sourcePath) return;
      const fileName = `${String(index + 1).padStart(3, "0")}-${safeDisplayName(item.title)}-${item.id.slice(-8)}.mp3`;
      const targetPath = path.join(batchDir, fileName);
      try {
        fs.linkSync(sourcePath, targetPath);
      } catch {
        fs.copyFileSync(sourcePath, targetPath);
      }
      manifest.push({ id: item.id, title: item.title, fileName });
    });
    if (!manifest.length) throw httpError(404, "勾选的音频文件已经不存在。");
    writeJsonAtomic(path.join(batchDir, "manifest.json"), { batchId, createdAt: new Date().toISOString(), items: manifest });
    return { batchId, audioDir: batchDir, count: manifest.length };
  }

  async function generateFromMarketing({ marketingId, rank, voiceId: requestedVoiceId }) {
    const safeMarketingId = safeStem(marketingId);
    const safeRank = Number(rank);
    if (!safeMarketingId || !Number.isInteger(safeRank) || safeRank < 1 || safeRank > 5) throw httpError(400, "缺少有效的营销素材编号或文案序号。");

    const marketingPath = path.join(workDir, "novel-marketing", `${safeMarketingId}.json`);
    if (!fs.existsSync(marketingPath)) throw httpError(404, "没有找到对应的营销素材，请重新生成文案。");
    const source = JSON.parse(fs.readFileSync(marketingPath, "utf8"));
    const selected = source?.marketing?.selected?.find((item) => Number(item.rank) === safeRank);
    const script = String(selected?.script || "").trim();
    if (script.length < 40) throw httpError(400, "这条营销素材没有可直接配音的正文，请重新生成新版文案。");

    const config = readConfig(root);
    const apiKey = String(process.env.ELEVENLABS_API_KEY || config.elevenLabsApiKey || "").trim();
    const voiceId = String(requestedVoiceId || config.elevenLabsVoiceId || findRecentVoiceId(workDir) || "").trim();
    const modelId = String(config.elevenLabsModelId || "eleven_multilingual_v2").trim();
    const outputFormat = String(config.elevenLabsOutputFormat || "mp3_44100_128").trim();
    if (!apiKey) throw httpError(400, "ElevenLabs API Key 未配置。");
    if (!voiceId) throw httpError(400, "ElevenLabs Voice ID 未配置。");

    const fingerprint = crypto.createHash("sha256")
      .update([safeMarketingId, safeRank, script, voiceId, modelId, outputFormat].join("\0"))
      .digest("hex").slice(0, 12);
    const id = safeStem(`audio-${safeMarketingId.slice(-22)}-${safeRank}-${fingerprint}`);
    const existing = get(id);
    if (existing && resolveAudioPath(id)) return { ...existing, cacheHit: true };
    if (inFlight.has(id)) return inFlight.get(id);

    const operation = synthesizeAndSave({ id, source, selected, script, apiKey, voiceId, modelId, outputFormat });
    inFlight.set(id, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(id);
    }
  }

  async function generateFromOptimizedScript({
    sourceAudioId,
    sourceVideoId = "",
    title,
    script,
    diagnosis = "",
    evidenceSummary = "",
    rewriteMetadata = {},
    planId = "",
    voiceId: requestedVoiceId,
    targetAudioDir = ""
  } = {}) {
    const cleanScript = String(script || "").trim();
    if (cleanScript.length < 40) throw httpError(400, "AI 重写文案过短，未调用 ElevenLabs。 ");
    const sourceItem = sourceAudioId ? get(sourceAudioId) : null;
    const config = readConfig(root);
    const apiKey = String(process.env.ELEVENLABS_API_KEY || config.elevenLabsApiKey || "").trim();
    const voiceId = String(requestedVoiceId || config.elevenLabsVoiceId || findRecentVoiceId(workDir) || "").trim();
    const modelId = String(config.elevenLabsModelId || "eleven_multilingual_v2").trim();
    const outputFormat = String(config.elevenLabsOutputFormat || "mp3_44100_128").trim();
    if (!apiKey) throw httpError(400, "ElevenLabs API Key 未配置。");
    if (!voiceId) throw httpError(400, "ElevenLabs Voice ID 未配置。");

    const fingerprint = crypto.createHash("sha256")
      .update([sourceAudioId, sourceVideoId, cleanScript, voiceId, modelId, outputFormat].join("\0"))
      .digest("hex").slice(0, 16);
    const id = safeStem(`rewrite-${sourceAudioId || sourceVideoId || "novel"}-${fingerprint}`);
    const existing = get(id);
    if (existing && resolveAudioPath(id)) return { ...existing, cacheHit: true };
    if (inFlight.has(id)) return inFlight.get(id);

    const selected = { title: String(title || sourceItem?.title || "AI 优化小说文案").trim(), rank: 0 };
    const operation = synthesizeAndSave({
      id,
      source: null,
      selected,
      script: cleanScript,
      apiKey,
      voiceId,
      modelId,
      outputFormat,
      targetAudioDir,
      recordSource: {
        type: "ai-operation-rewrite",
        sourceAudioId: safeStem(sourceAudioId),
        sourceVideoId: String(sourceVideoId || "").trim(),
        planId: safeStem(planId)
      },
      metadata: {
        diagnosis: String(diagnosis || "").trim().slice(0, 1200),
        evidenceSummary: String(evidenceSummary || "").trim().slice(0, 1200),
        problemLayer: String(rewriteMetadata?.problemLayer || "").trim().slice(0, 40),
        rewriteScope: String(rewriteMetadata?.rewriteScope || "").trim().slice(0, 40),
        targetSecondRange: String(rewriteMetadata?.targetSecondRange || "").trim().slice(0, 40),
        estimatedSourceSentence: String(rewriteMetadata?.estimatedSourceSentence || "").trim().slice(0, 600),
        rewriteGoal: String(rewriteMetadata?.rewriteGoal || "").trim().slice(0, 500),
        singleVariable: String(rewriteMetadata?.singleVariable || "").trim().slice(0, 80),
        preservedFacts: Array.isArray(rewriteMetadata?.preservedFacts) ? rewriteMetadata.preservedFacts.slice(0, 8).map((value) => String(value || "").trim().slice(0, 120)) : [],
        changeLog: Array.isArray(rewriteMetadata?.changeLog) ? rewriteMetadata.changeLog.slice(0, 6) : []
      }
    });
    inFlight.set(id, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(id);
    }
  }

  async function generateFromScript({
    script,
    title,
    openingTitle = "",
    speakOpeningTitle,
    voiceId: requestedVoiceId,
    targetAudioDir = "",
    novelId = "",
    scriptId = "",
    sourceType = "manual-script",
    speechSpeed
  } = {}) {
    const cleanScript = String(script || "").trim();
    if (cleanScript.length < 20) throw httpError(400, "文案至少需要 20 个字符才能配音。");
    const config = readConfig(root);
    const apiKey = String(process.env.ELEVENLABS_API_KEY || config.elevenLabsApiKey || "").trim();
    const voiceId = String(requestedVoiceId || config.elevenLabsVoiceId || findRecentVoiceId(workDir) || "").trim();
    const modelId = NOVEL_TTS_MODEL_ID;
    const outputFormat = String(config.elevenLabsOutputFormat || "mp3_44100_128").trim();
    if (!apiKey) throw httpError(400, "ElevenLabs API Key 未配置。");
    if (!voiceId) throw httpError(400, "ElevenLabs Voice ID 未配置。");

    const spokenScript = buildSpokenNarration(
      speakOpeningTitle === false ? "" : resolveScriptOpeningTitle(openingTitle, scriptId),
      cleanScript
    );
    const speed = normalizeSpeechSpeed(speechSpeed);
    const fingerprint = crypto.createHash("sha256")
      .update([novelId, scriptId, spokenScript, voiceId, modelId, outputFormat, speed === DEFAULT_SPEECH_SPEED ? "" : String(speed)].join("\0"))
      .digest("hex").slice(0, 16);
    const id = safeStem(`script-${scriptId || novelId || "manual"}-${fingerprint}`);
    const existing = get(id);
    if (existing && resolveAudioPath(id)) return { ...existing, cacheHit: true };
    if (inFlight.has(id)) return inFlight.get(id);

    const selected = { title: String(title || "小说开头文案").trim(), rank: 0 };
    const operation = synthesizeAndSave({
      id,
      source: null,
      selected,
      script: spokenScript,
      apiKey,
      voiceId,
      modelId,
      outputFormat,
      speechSpeed: speed,
      targetAudioDir,
      recordSource: {
        type: String(sourceType || "manual-script").trim().slice(0, 40) || "manual-script",
        novelId: safeStem(novelId),
        scriptId: safeStem(scriptId)
      }
    });
    inFlight.set(id, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(id);
    }
  }

  function resolveScriptOpeningTitle(openingTitle, scriptId) {
    const passed = String(openingTitle || "").trim();
    if (passed) return passed;
    const id = String(scriptId || "").trim();
    if (!id) return "";
    try {
      const store = JSON.parse(fs.readFileSync(path.join(workDir, "novel-content-library.json"), "utf8"));
      const script = (Array.isArray(store.scripts) ? store.scripts : []).find((item) => item.id === id);
      return String(script?.openingTitle || "").trim();
    } catch {
      return "";
    }
  }

  async function listVoices() {
    const config = readConfig(root);
    const apiKey = String(process.env.ELEVENLABS_API_KEY || config.elevenLabsApiKey || "").trim();
    const defaultVoiceId = String(
      config.elevenLabsVoiceId
      || (typeof getDefaultVoiceId === "function" ? getDefaultVoiceId() : "")
      || findRecentVoiceId(workDir)
      || ""
    ).trim();
    try {
      return await listElevenLabsVoices({ apiKey, defaultVoiceId, fetchImpl });
    } catch (error) {
      throw httpError(error.statusCode || 502, error.message);
    }
  }

  async function getVoice(voiceId) {
    const safeVoiceId = String(voiceId || "").trim();
    if (!safeVoiceId) throw httpError(400, "缺少 Voice ID。");
    const config = readConfig(root);
    const apiKey = String(process.env.ELEVENLABS_API_KEY || config.elevenLabsApiKey || "").trim();
    if (!apiKey) throw httpError(400, "ElevenLabs API Key 未配置。");
    const response = await fetchImpl(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(safeVoiceId)}`, {
      headers: { "xi-api-key": apiKey, Accept: "application/json" }
    });
    const body = await readJsonSafe(response);
    if (!response.ok) {
      throw httpError(response.status || 502, `读取声音详情失败：${voiceErrorDetail(body) || response.status}`);
    }
    return {
      id: String(body.voice_id || safeVoiceId).trim(),
      name: String(body.name || safeVoiceId).trim(),
      category: String(body.category || "").trim(),
      previewUrl: String(body.preview_url || "").trim()
    };
  }

  async function previewVoiceAudio(voiceId) {
    const safeVoiceId = String(voiceId || "").trim();
    if (!safeVoiceId) throw httpError(400, "请先选择要试听的声音。");
    let voice = null;
    try {
      voice = await getVoice(safeVoiceId);
    } catch (error) {
      if (Number(error.statusCode) === 404) throw error;
    }
    if (voice?.previewUrl) return { kind: "remote", url: voice.previewUrl, voice };
    const config = readConfig(root);
    const apiKey = String(process.env.ELEVENLABS_API_KEY || config.elevenLabsApiKey || "").trim();
    const modelId = NOVEL_TTS_MODEL_ID;
    const outputFormat = String(config.elevenLabsOutputFormat || "mp3_44100_128").trim();
    if (!apiKey) throw httpError(400, "ElevenLabs API Key 未配置。");
    const previewDir = path.join(libraryDir, "previews");
    fs.mkdirSync(previewDir, { recursive: true });
    const outputPath = path.join(previewDir, `${safeStem(safeVoiceId)}.mp3`);
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) {
      return { kind: "file", path: outputPath, voice: voice || { id: safeVoiceId, name: safeVoiceId, previewUrl: "" }, cacheHit: true };
    }
    const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(safeVoiceId)}?output_format=${encodeURIComponent(outputFormat)}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "This is a short preview of this voice for novel narration.",
        model_id: modelId
      })
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      throw httpError(response.status || 502, `试听失败：${buffer.toString("utf8").slice(0, 400) || response.status}`);
    }
    if (buffer.length < 1024) throw httpError(502, "ElevenLabs 没有返回有效试听音频。");
    const tempPath = `${outputPath}.tmp`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, outputPath);
    return { kind: "file", path: outputPath, voice: voice || { id: safeVoiceId, name: safeVoiceId, previewUrl: "" }, cacheHit: false };
  }

  async function synthesizeAndSave({
    id, source, selected, script, apiKey, voiceId, modelId, outputFormat,
    speechSpeed = DEFAULT_SPEECH_SPEED, targetAudioDir = "", recordSource = null, metadata = null
  }) {
    const speed = normalizeSpeechSpeed(speechSpeed);
    const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: script,
        model_id: modelId,
        voice_settings: { speed }
      })
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      const detail = buffer.toString("utf8").slice(0, 800);
      throw httpError(response.status || 502, `ElevenLabs 配音失败：${detail || response.status}`);
    }
    if (buffer.length < 1024) throw httpError(502, "ElevenLabs 没有返回有效音频。");

    const fileName = `${id}.mp3`;
    const outputPath = path.join(filesDir, fileName);
    const tempPath = `${outputPath}.tmp`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, outputPath);
    tightenSpeechAudio(outputPath, outputPath, configFfmpeg(readConfig(root)));
    let targetAudioPath = "";
    if (String(targetAudioDir || "").trim()) {
      const resolvedTargetDir = path.resolve(String(targetAudioDir).trim());
      fs.mkdirSync(resolvedTargetDir, { recursive: true });
      targetAudioPath = path.join(resolvedTargetDir, `${safeDisplayName(selected.title || "AI优化文案")}-${id.slice(-12)}.mp3`);
      if (path.resolve(targetAudioPath) !== path.resolve(outputPath)) fs.copyFileSync(outputPath, targetAudioPath);
    }
    const record = {
      id,
      title: String(selected.title || source?.source?.title || "未命名音频").trim(),
      fileName,
      createdAt: new Date().toISOString(),
      duration: probeDuration(outputPath, configFfprobe(readConfig(root))),
      size: fs.statSync(outputPath).size,
      scriptChars: script.length,
      script,
      modelId,
      speechSpeed: speed,
      source: recordSource || { marketingId: source?.id || "", rank: Number(selected.rank) || 0 },
      targetAudioPath,
      metadata: metadata || undefined
    };
    const records = readIndex(indexPath).filter((item) => item.id !== id);
    records.push(record);
    writeJsonAtomic(indexPath, records);
    return { ...record, cacheHit: false };
  }

  function retuneSpeed({ id, speed } = {}) {
    const item = get(id);
    if (!item) throw httpError(404, "没有这条音频。");
    const factor = normalizeRetuneSpeed(speed);
    const currentPath = resolveAudioPath(item.id);
    if (!currentPath) throw httpError(404, "音频文件不存在。");
    const sourceName = `${item.id}.source.mp3`;
    const sourcePath = path.join(filesDir, sourceName);
    if (!fs.existsSync(sourcePath)) fs.copyFileSync(currentPath, sourcePath);
    const originalDuration = Number(item.originalDuration) > 0 ? Number(item.originalDuration) : Number(item.duration) || 0;
    const outputPath = path.join(filesDir, item.fileName);
    const tempPath = `${outputPath}.retune.tmp.mp3`;
    const ffmpeg = configFfmpeg(readConfig(root));
    tightenSpeechAudio(sourcePath, sourcePath, ffmpeg);
    const result = spawnSync(ffmpeg, [
      "-y", "-hide_banner", "-i", sourcePath,
      "-filter:a", `atempo=${factor.toFixed(2)}`,
      "-vn", "-c:a", "libmp3lame", "-q:a", "4",
      tempPath
    ], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0 || !fs.existsSync(tempPath) || fs.statSync(tempPath).size < 1024) {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      throw httpError(502, `音频变速失败：${String(result.stderr || result.stdout || "").slice(0, 400) || "ffmpeg 未返回有效文件"}`);
    }
    fs.renameSync(tempPath, outputPath);
    if (item.targetAudioPath && fs.existsSync(path.dirname(item.targetAudioPath))) {
      try { fs.copyFileSync(outputPath, item.targetAudioPath); } catch {}
    }
    const next = {
      ...item,
      duration: probeDuration(outputPath, configFfprobe(readConfig(root))),
      size: fs.statSync(outputPath).size,
      playbackSpeed: factor,
      originalDuration,
      sourceFileName: sourceName,
      retunedAt: new Date().toISOString()
    };
    const records = readIndex(indexPath).filter((entry) => entry.id !== item.id);
    records.push(next);
    writeJsonAtomic(indexPath, records);
    return next;
  }

  return { list, get, resolveAudioPath, generateFromMarketing, generateFromOptimizedScript, generateFromScript, listVoices, getVoice, previewVoiceAudio, prepareTaskBatch, retuneSpeed };
}

function readIndex(indexPath) {
  try {
    const value = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function safeStem(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

function safeDisplayName(value) {
  return String(value || "audio").trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").slice(0, 80) || "audio";
}

function configFfprobe(config) {
  return String(config.ffprobePath || "ffprobe");
}

function configFfmpeg(config) {
  return String(config.ffmpegPath || "ffmpeg");
}

export function tightenSpeechFilter() {
  return [
    "silenceremove=start_periods=1:start_silence=0.06:start_threshold=-34dB:detection=peak",
    "areverse",
    "silenceremove=start_periods=1:start_silence=0.06:start_threshold=-34dB:detection=peak",
    "areverse",
    "silenceremove=window=0.02:detection=peak:stop_periods=-1:stop_duration=0.28:stop_threshold=-34dB:stop_silence=0.10"
  ].join(",");
}

export function tightenSpeechAudio(inputPath, outputPath = inputPath, ffmpeg = "ffmpeg") {
  const source = String(inputPath || "").trim();
  const target = String(outputPath || inputPath).trim();
  if (!source || !fs.existsSync(source)) return false;
  const tempPath = `${target}.tighten.tmp.mp3`;
  const result = spawnSync(ffmpeg, [
    "-y", "-hide_banner", "-i", source,
    "-filter:a", tightenSpeechFilter(),
    "-vn", "-c:a", "libmp3lame", "-q:a", "4",
    tempPath
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || !fs.existsSync(tempPath) || fs.statSync(tempPath).size < 1024) {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    return false;
  }
  fs.renameSync(tempPath, target);
  return true;
}

function probeDuration(filePath, executable) {
  try {
    const result = spawnSync(executable, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], { encoding: "utf8", windowsHide: true });
    const duration = Number(String(result.stdout || "").trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function voiceErrorDetail(body) {
  if (!body || typeof body !== "object") return "";
  if (typeof body.detail === "string") return body.detail;
  if (typeof body.message === "string") return body.message;
  if (body.detail && typeof body.detail === "object") {
    return String(body.detail.message || body.detail.status || JSON.stringify(body.detail)).slice(0, 400);
  }
  return "";
}

function findRecentVoiceId(workDir) {
  const jobsDir = path.join(workDir, "jobs");
  if (!fs.existsSync(jobsDir)) return "";
  try {
    const files = fs.readdirSync(jobsDir)
      .filter((name) => name.endsWith(".payload.json"))
      .map((name) => ({ name, time: fs.statSync(path.join(jobsDir, name)).mtimeMs }))
      .sort((left, right) => right.time - left.time)
      .slice(0, 200);
    for (const file of files) {
      const payload = JSON.parse(fs.readFileSync(path.join(jobsDir, file.name), "utf8"));
      const voiceId = String(payload.elevenLabsVoiceId || "").trim();
      if (voiceId) return voiceId;
    }
  } catch {}
  return "";
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
