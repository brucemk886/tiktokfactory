import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeCaptionCues, normalizeCaptionWords } from "./caption-cache.js";
import {
  DEFAULT_KOKORO_CHINESE_VOICE,
  DEFAULT_KOKORO_VOICE,
  KOKORO_VOICES,
  isKokoroVoiceId,
  kokoroLangCode,
  listKokoroVoices,
  normalizeTtsProvider,
  resolveKokoroVoice,
  resolveVoiceForProvider
} from "./kokoro-voices.js";

export {
  DEFAULT_KOKORO_CHINESE_VOICE,
  DEFAULT_KOKORO_VOICE,
  KOKORO_VOICES,
  isKokoroVoiceId,
  kokoroLangCode,
  listKokoroVoices,
  normalizeTtsProvider,
  resolveKokoroVoice,
  resolveVoiceForProvider
};

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_KOKORO_ROOT = "D:/localfactory-data/tools/kokoro";
export const KOKORO_PREVIEW_TEXT = "This is a short preview of this local Kokoro voice for novel narration.";

export function resolveKokoroInstall(config = {}) {
  const root = String(config.kokoroRoot || process.env.KOKORO_ROOT || DEFAULT_KOKORO_ROOT).trim();
  const python = String(config.kokoroPython || process.env.KOKORO_PYTHON || path.join(root, "venv/Scripts/python.exe")).trim();
  const script = path.join(here, "kokoro-generate.py");
  return { root, python, script };
}

export function assertKokoroReady(config = {}) {
  const install = resolveKokoroInstall(config);
  if (!fs.existsSync(install.python)) {
    throw Object.assign(new Error(`本机还没装好 Kokoro：找不到 ${install.python}`), { statusCode: 400 });
  }
  if (!fs.existsSync(install.script)) {
    throw Object.assign(new Error("仓库里缺少 scripts/kokoro-generate.py。"), { statusCode: 500 });
  }
  return install;
}

export function generateKokoroSpeech({
  text,
  voice = DEFAULT_KOKORO_VOICE,
  speed = 1,
  minimumCharacters = 20,
  outDir,
  ffmpeg = "ffmpeg",
  config = {}
} = {}) {
  const script = String(text || "").trim();
  const minimum = Math.max(1, Math.floor(Number(minimumCharacters) || 20));
  if (Array.from(script).length < minimum) {
    throw Object.assign(new Error(`文案至少需要 ${minimum} 个字符才能配音。`), { statusCode: 400 });
  }
  const install = assertKokoroReady(config);
  const destDir = String(outDir || "").trim();
  if (!destDir) throw Object.assign(new Error("缺少 Kokoro 输出目录。"), { statusCode: 500 });
  fs.mkdirSync(destDir, { recursive: true });
  const wavPath = path.join(destDir, "speech.wav");
  const mp3Path = path.join(destDir, "speech.mp3");
  const metaPath = path.join(destDir, "speech.json");
  const textPath = path.join(destDir, "speech.txt");
  fs.writeFileSync(textPath, script, "utf8");
  const result = spawnSync(install.python, [
    install.script,
    "--text-file", textPath,
    "--voice", resolveKokoroVoice(voice),
    "--lang", kokoroLangCode(voice),
    "--speed", String(speed || 1),
    "--out", wavPath,
    "--meta", metaPath
  ], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15 * 60 * 1000,
    env: { ...process.env, KOKORO_ROOT: install.root }
  });
  if (result.status !== 0 || !fs.existsSync(wavPath)) {
    throw Object.assign(new Error(`Kokoro 配音失败：${String(result.stderr || result.stdout || "").trim().slice(-800) || result.status}`), { statusCode: 502 });
  }
  encodeMp3(wavPath, mp3Path, ffmpeg);
  const meta = readJson(metaPath);
  const words = normalizeCaptionWords(meta.words);
  return {
    wavPath,
    mp3Path,
    duration: Number(meta.duration) || 0,
    voice: resolveKokoroVoice(voice),
    text: script,
    words,
    cues: makeCaptionCues(words, script)
  };
}

function encodeMp3(wavPath, mp3Path, ffmpeg) {
  const result = spawnSync(ffmpeg || "ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", wavPath,
    "-vn", "-c:a", "libmp3lame", "-q:a", "4",
    mp3Path
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || !fs.existsSync(mp3Path) || fs.statSync(mp3Path).size < 1024) {
    throw Object.assign(new Error(`Kokoro 转 mp3 失败：${String(result.stderr || result.stdout || "").slice(0, 400)}`), { statusCode: 502 });
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}
