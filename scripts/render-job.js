import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { ensureProject, readConfig, renderPodcastVideo } from "./video-core.js";
import { resolveStorageDirs } from "./storage-paths.js";

const root = process.cwd();
const bootConfig = readConfig(root);
const { workDir } = resolveStorageDirs(root, bootConfig);
const captionCacheDir = path.join(workDir, "caption-cache");
const payloadPath = process.argv[2];
const jobPath = process.argv[3];

runJob().catch((error) => {
  updateJob({
    status: "failed",
    percent: 100,
    message: error.message || "Generation failed.",
    error: error.message || "Generation failed.",
    updatedAt: Date.now()
  });
  process.exitCode = 1;
});

async function runJob() {
  ensureProject(root);
  if (!payloadPath || !jobPath) throw new Error("Missing job arguments.");

  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const id = safeId(payload.id || payload.jobId || timestampId());
  const title = String(payload.title || "").trim();
  const text = String(payload.text || "").trim();
  const template = payload.template || "player";
  const config = readConfig(root);
  const renderConfig = applyAspect(config, payload.aspect);
  const hasUploadedAudio = Boolean(payload.audioBase64 && payload.audioName);
  const hasAudioUrl = Boolean(String(payload.audioUrl || "").trim());
  const hasLibraryAudio = Boolean(String(payload.audioLibraryPath || "").trim());
  let audioPath = null;
  let backgroundPath = null;
  let captions = null;

  updateJob({
    status: "running",
    percent: 5,
    message: "Preparing assets...",
    updatedAt: Date.now()
  });

  if (payload.backgroundBase64 && payload.backgroundName) {
    const ext = safeImageExtension(payload.backgroundName);
    backgroundPath = path.join(workDir, `${id}.background${ext}`);
    fs.writeFileSync(backgroundPath, Buffer.from(payload.backgroundBase64, "base64"));
  }

  if (hasLibraryAudio) {
    const candidate = path.resolve(String(payload.audioLibraryPath));
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error("音频素材库文件不存在。");
    audioPath = candidate;
    updateJob({ status: "running", percent: 12, message: "Loaded audio library file.", updatedAt: Date.now() });
  } else if (hasUploadedAudio) {
    updateJob({
      status: "running",
      percent: 12,
      message: "Reading uploaded audio...",
      updatedAt: Date.now()
    });
    const ext = safeAudioExtension(payload.audioName);
    audioPath = path.join(workDir, `${id}${ext}`);
    fs.writeFileSync(audioPath, Buffer.from(payload.audioBase64, "base64"));
  } else if (hasAudioUrl) {
    updateJob({
      status: "running",
      percent: 12,
      message: isTikTokTextUrl(payload.audioUrl) ? "Extracting TikTok audio..." : "Downloading audio URL...",
      updatedAt: Date.now()
    });
    audioPath = await downloadAudioUrl(payload.audioUrl, workDir, id, payload.audioName);
  } else if (payload.autoTts !== false) {
    updateJob({
      status: "running",
      percent: 12,
      message: "Generating voiceover...",
      updatedAt: Date.now()
    });
    audioPath = await synthesizeAudio({ id, text, payload, renderConfig });
  }

  const duration = audioPath
    ? probeDuration(audioPath, Number(payload.duration) || renderConfig.defaultDuration)
    : Number(payload.duration) || renderConfig.defaultDuration;

  if (audioPath && payload.autoCaptions && supportsCaptions(template)) {
    const sttModelId = renderConfig.elevenLabsSttModelId || "scribe_v2";
    updateJob({
      status: "running",
      percent: 24,
      message: "Preparing subtitles...",
      duration,
      updatedAt: Date.now()
    });
    const captionResult = await getCachedOrTranscribeCaptions({
      audioPath,
      apiKey: process.env.ELEVENLABS_API_KEY || renderConfig.elevenLabsApiKey,
      modelId: sttModelId
    });
    captions = captionResult.captions;
    updateJob({
      status: "running",
      percent: 28,
      message: captionResult.cacheHit ? "Loaded cached subtitles." : "Subtitles recognized and cached.",
      duration,
      updatedAt: Date.now()
    });
  }

  updateJob({
    status: "running",
    percent: 30,
    message: templateMessage(template),
    duration,
    renderStartedAt: Date.now(),
    estimatedRenderMs: estimateRenderMs(template, duration) + estimateCaptionBurnMs(captions, duration),
    updatedAt: Date.now()
  });

  const result = renderPodcastVideo({
    root,
    config: renderConfig,
    id,
    title,
    scriptText: text,
    audioPath,
    backgroundPath,
    backgroundColor: payload.backgroundColor,
    template,
    duration,
    captions,
    captionPositions: payload.captionPositions
  });

  updateJob({
    status: "done",
    percent: 100,
    message: "Generation complete.",
    result: {
      id: result.id,
      title: result.title,
      duration: result.duration,
      videoUrl: `/outputs/${encodeURIComponent(path.basename(result.outputPath))}`
    },
    updatedAt: Date.now()
  });
}

async function synthesizeAudio({ id, text, payload, renderConfig }) {
  if (payload.ttsProvider === "elevenlabs") {
    return synthesizeWithElevenLabs({
      id,
      text,
      apiKey: process.env.ELEVENLABS_API_KEY || renderConfig.elevenLabsApiKey,
      voiceId: payload.elevenLabsVoiceId || renderConfig.elevenLabsVoiceId,
      modelId: payload.elevenLabsModelId || renderConfig.elevenLabsModelId,
      outputFormat: payload.elevenLabsOutputFormat || renderConfig.elevenLabsOutputFormat
    });
  }

  return synthesizeSpeech({
    id,
    text,
    voiceName: renderConfig.ttsVoice,
    rate: renderConfig.ttsRate,
    volume: renderConfig.ttsVolume
  });
}

function updateJob(patch) {
  const current = fs.existsSync(jobPath) ? JSON.parse(fs.readFileSync(jobPath, "utf8")) : {};
  fs.writeFileSync(jobPath, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}

function templateMessage(template) {
  if (template === "minimal-wave") return "Rendering template 3 video...";
  if (template === "journal-wave") return "Rendering template 4 video...";
  if (template === "center-wave") return "Rendering template 2 video...";
  return "Rendering template 1 video...";
}

function estimateRenderMs(template, duration) {
  const safeDuration = Math.max(1, Number(duration) || 1);
  if (template === "minimal-wave") return Math.max(9000, safeDuration * 260);
  if (template === "journal-wave") return Math.max(18000, safeDuration * 650);
  if (template === "center-wave") return Math.max(15000, safeDuration * 560);
  return Math.max(18000, safeDuration * 650);
}

function estimateCaptionBurnMs(captions, duration) {
  if (!captions?.cues?.length) return 0;
  const safeDuration = Math.max(1, Number(duration) || 1);
  return Math.max(8000, safeDuration * 360);
}

function supportsCaptions(template) {
  return ["player", "center-wave", "minimal-wave", "journal-wave"].includes(template);
}

async function getCachedOrTranscribeCaptions({ audioPath, apiKey, modelId }) {
  const audioBuffer = fs.readFileSync(audioPath);
  const cacheKey = makeCaptionCacheKey({ audioBuffer, modelId });
  const cachePath = path.join(captionCacheDir, `${cacheKey}.json`);
  const cached = readCaptionCache(cachePath);
  if (cached) return { captions: cached, cacheHit: true };

  const captions = await transcribeCaptionsWithElevenLabs({
    audioPath,
    apiKey,
    modelId,
    audioBuffer
  });
  writeCaptionCache(cachePath, captions);
  return { captions, cacheHit: false };
}

function makeCaptionCacheKey({ audioBuffer, modelId }) {
  return crypto
    .createHash("sha256")
    .update("caption-cache-v2-word-cues")
    .update("\0")
    .update(String(modelId || "scribe_v2"))
    .update("\0")
    .update(audioBuffer)
    .digest("hex");
}

function readCaptionCache(cachePath) {
  if (!fs.existsSync(cachePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (Array.isArray(data?.cues) && data.cues.some((cue) => String(cue?.text || "").trim())) {
      return data;
    }
  } catch {
    return null;
  }
  return null;
}

function writeCaptionCache(cachePath, captions) {
  if (!Array.isArray(captions?.cues) || !captions.cues.length) return;
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify({
    ...captions,
    cachedAt: new Date().toISOString()
  }, null, 2), "utf8");
  try {
    fs.renameSync(tempPath, cachePath);
  } catch {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cache cleanup failures; rendering can continue without the cache.
    }
  }
}

async function transcribeCaptionsWithElevenLabs({ audioPath, apiKey, modelId, audioBuffer = null }) {
  if (!apiKey) throw new Error("ElevenLabs API key is not configured.");
  const buffer = audioBuffer || fs.readFileSync(audioPath);
  const form = new FormData();
  form.append("model_id", modelId || "scribe_v2");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");
  form.append("file", new Blob([buffer]), path.basename(audioPath));

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`ElevenLabs subtitle recognition failed: ${raw.slice(0, 800) || response.status}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("ElevenLabs subtitle recognition returned invalid JSON.");
  }

  const cues = makeCaptionCues(data.words, data.text);
  if (!cues.length) throw new Error("ElevenLabs did not return usable subtitle timestamps.");
  return {
    provider: "elevenlabs",
    model: modelId || "scribe_v2",
    text: data.text || "",
    words: makeWordCues(data.words),
    cues
  };
}

function makeWordCues(words = []) {
  return Array.isArray(words)
    ? words
        .map((item) => ({
          text: cleanCaptionToken(item.text || item.word || ""),
          start: Number(item.start ?? item.start_time),
          end: Number(item.end ?? item.end_time)
        }))
        .filter((item) => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= item.start)
        .map((item) => ({
          text: item.text,
          start: Math.max(0, item.start),
          end: Math.max(item.start + 0.08, item.end)
        }))
    : [];
}

function makeCaptionCues(words = [], fallbackText = "") {
  const normalized = Array.isArray(words)
    ? words
        .map((item) => ({
          text: String(item.text || item.word || "").trim(),
          start: Number(item.start ?? item.start_time),
          end: Number(item.end ?? item.end_time)
        }))
        .filter((item) => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= item.start)
    : [];

  if (!normalized.length) {
    const text = String(fallbackText || "").trim();
    return text ? [{ start: 0, end: 3, text }] : [];
  }

  const cues = [];
  let current = null;
  for (const word of normalized) {
    const token = cleanCaptionToken(word.text);
    if (!token) continue;
    if (!current) {
      current = { start: word.start, end: word.end, text: token, chars: visibleLength(token) };
      continue;
    }

    const gap = Math.max(0, word.start - current.end);
    const nextText = joinCaptionText(current.text, token);
    const nextChars = visibleLength(nextText);
    const duration = word.end - current.start;
    const shouldBreak = gap > 0.45 || duration > 2.8 || nextChars > 24 || /[。！？!?]$/.test(current.text);

    if (shouldBreak) {
      cues.push(fitCaptionCue(current));
      current = { start: word.start, end: word.end, text: token, chars: visibleLength(token) };
    } else {
      current.text = nextText;
      current.end = word.end;
      current.chars = nextChars;
    }
  }

  if (current) cues.push(fitCaptionCue(current));
  return cues.filter((cue) => cue.end > cue.start && cue.text);
}

function cleanCaptionToken(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function joinCaptionText(left, right) {
  if (!left) return right;
  if (!right) return left;
  return /[\u4e00-\u9fff]$/.test(left) || /^[\u4e00-\u9fff，。！？、；：]/.test(right)
    ? `${left}${right}`
    : `${left} ${right}`;
}

function visibleLength(value) {
  return Array.from(String(value || "")).reduce((sum, char) => sum + (/[\u4e00-\u9fff]/.test(char) ? 2 : 1), 0);
}

function fitCaptionCue(cue) {
  return {
    start: Math.max(0, Number(cue.start) || 0),
    end: Math.max(Number(cue.start) + 0.35, Number(cue.end) || Number(cue.start) + 0.35),
    text: String(cue.text || "").trim()
  };
}

function probeDuration(filePath, fallback) {
  const result = spawnSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ], { encoding: "utf8" });
  if (result.status !== 0) return fallback;
  const duration = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(duration) && duration > 0 ? duration : fallback;
}

function safeAudioExtension(fileName) {
  const ext = path.extname(String(fileName)).toLowerCase();
  return [".mp3", ".wav", ".m4a", ".aac", ".opus", ".webm"].includes(ext) ? ext : ".mp3";
}

async function downloadAudioUrl(audioUrl, targetDir, id, fileName = "") {
  let parsed;
  try {
    parsed = new URL(String(audioUrl).trim());
  } catch {
    throw new Error("Audio URL format is invalid.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Audio URL only supports http or https.");
  }

  if (isTikTokUrl(parsed)) {
    return downloadMediaAudioWithYtDlp(String(audioUrl).trim(), targetDir, id);
  }

  const response = await fetch(parsed);
  if (!response.ok) {
    throw new Error(`Audio URL download failed: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) throw new Error("Audio URL did not return a valid audio file.");

  const ext = safeAudioExtension(fileName || parsed.pathname);
  const outputPath = path.join(targetDir, `${id}.remote${ext}`);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

function isTikTokTextUrl(value) {
  try {
    return isTikTokUrl(new URL(String(value).trim()));
  } catch {
    return false;
  }
}

function isTikTokUrl(parsed) {
  return /(^|\.)tiktok\.com$/i.test(parsed.hostname);
}

function downloadMediaAudioWithYtDlp(mediaUrl, targetDir, id) {
  const outputTemplate = path.join(targetDir, `${id}.remote.%(ext)s`);
  const before = new Set(fs.readdirSync(targetDir));
  const ytDlp = resolveYtDlpCommand();
  const cookieFile = resolveTikTokCookieFile();
  const attempts = [
    ["direct", []],
    ["mobile chrome", ["--impersonate", "chrome-131:android-14"]],
    ...(cookieFile ? [["cookies.txt", ["--cookies", cookieFile]]] : []),
    ["edge cookies", ["--cookies-from-browser", "edge"]],
    ["chrome cookies", ["--cookies-from-browser", "chrome"]],
    ["firefox cookies", ["--cookies-from-browser", "firefox"]]
  ];
  const errors = [];

  for (const [label, extraArgs] of attempts) {
    const result = runYtDlpAudioExtract(ytDlp, outputTemplate, mediaUrl, extraArgs);
    if (result.status === 0) break;
    errors.push(`${label} failed: ${extractCommandError(result)}`);
  }

  if (errors.length === attempts.length) {
    throw new Error(`TikTok audio extraction failed: ${errors.join("; ")}`);
  }

  const downloaded = fs.readdirSync(targetDir)
    .filter((name) => !before.has(name) && name.startsWith(`${id}.remote.`))
    .map((name) => path.join(targetDir, name))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).size > 1024)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  const audioPath = downloaded.find((filePath) => [".mp3", ".m4a", ".wav", ".aac", ".opus", ".webm"].includes(path.extname(filePath).toLowerCase()));
  if (!audioPath) throw new Error("TikTok audio extraction failed: no valid audio file was generated.");
  return audioPath;
}

function runYtDlpAudioExtract(ytDlp, outputTemplate, mediaUrl, extraArgs = []) {
  return spawnSync(ytDlp, [
    "--no-playlist",
    "--no-warnings",
    "--no-update",
    "--force-overwrites",
    ...extraArgs,
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "-o",
    outputTemplate,
    mediaUrl
  ], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
}

function resolveTikTokCookieFile() {
  const candidates = [
    path.join(root, "input", "cookies", "tiktok-cookies.txt"),
    path.join(root, "input", "cookies.txt"),
    path.join(root, "cookies.txt")
  ];
  return candidates.find((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).size > 0) || "";
}

function resolveYtDlpCommand() {
  for (const command of ["yt-dlp", "yt-dlp.exe"]) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) return command;
  }
  throw new Error("yt-dlp was not found. Install yt-dlp before using TikTok audio extraction.");
}

function extractCommandError(result) {
  return String(result.stderr || result.stdout || "unknown error").trim().slice(0, 1200);
}

function safeImageExtension(fileName) {
  const ext = path.extname(String(fileName)).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".png";
}

function safeId(value) {
  const cleaned = String(value)
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || timestampId();
}

function timestampId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

function applyAspect(config, aspect) {
  if (aspect === "landscape") {
    return {
      ...config,
      width: 1920,
      height: 1080,
      titleFontSize: 52,
      timeFontSize: 40,
      controlFontSize: 82
    };
  }

  return {
    ...config,
    width: 1080,
    height: 1920,
    titleFontSize: 58,
    timeFontSize: 44,
    controlFontSize: 88
  };
}

function synthesizeSpeech({ id, text, voiceName, rate, volume }) {
  const textPath = path.join(workDir, `${id}.tts.txt`);
  const outputPath = path.join(workDir, `${id}.tts.wav`);
  fs.writeFileSync(textPath, text, "utf8");

  const scriptPath = path.join(root, "scripts", "sapi-tts.ps1");
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-TextPath",
    textPath,
    "-OutputPath",
    outputPath,
    "-Rate",
    String(Number.isFinite(Number(rate)) ? Number(rate) : 0),
    "-Volume",
    String(Number.isFinite(Number(volume)) ? Number(volume) : 100)
  ];

  if (voiceName) args.push("-VoiceName", String(voiceName));

  const result = spawnSync("powershell.exe", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Local TTS failed: ${result.stderr || result.stdout || "unknown error"}`);
  }
  assertAudioFile(outputPath, "Local TTS failed: no valid audio was generated.");

  return outputPath;
}

async function synthesizeWithElevenLabs({ id, text, apiKey, voiceId, modelId, outputFormat }) {
  if (!apiKey) throw new Error("ElevenLabs API key is not configured.");
  if (!voiceId) throw new Error("Please enter an ElevenLabs Voice ID.");

  const safeFormat = outputFormat || "mp3_44100_128";
  const outputPath = path.join(workDir, `${id}.elevenlabs.mp3`);
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(safeFormat)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      model_id: modelId || "eleven_multilingual_v2"
    })
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const message = buffer.toString("utf8").slice(0, 800);
    throw new Error(`ElevenLabs TTS failed: ${message || response.status}`);
  }

  fs.writeFileSync(outputPath, buffer);
  assertAudioFile(outputPath, "ElevenLabs did not return valid audio.");
  return outputPath;
}

function assertAudioFile(filePath, message) {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (!stat || stat.size < 1024) throw new Error(message);
}
