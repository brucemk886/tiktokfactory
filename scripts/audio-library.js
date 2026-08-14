import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const NOVEL_TTS_MODEL_ID = "eleven_multilingual_v2";
export const NOVEL_TTS_MODEL_NAME = "Eleven Multilingual v2";
export const DEFAULT_SPEECH_SPEED = 1;
export const MIN_SPEECH_SPEED = 0.7;
export const MAX_SPEECH_SPEED = 1.2;

export function normalizeSpeechSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return DEFAULT_SPEECH_SPEED;
  return Math.max(MIN_SPEECH_SPEED, Math.min(MAX_SPEECH_SPEED, Math.round(speed * 20) / 20));
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

    const speed = normalizeSpeechSpeed(speechSpeed);
    const fingerprint = crypto.createHash("sha256")
      .update([novelId, scriptId, cleanScript, voiceId, modelId, outputFormat, speed === DEFAULT_SPEECH_SPEED ? "" : String(speed)].join("\0"))
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
      script: cleanScript,
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

  async function listVoices() {
    const config = readConfig(root);
    const apiKey = String(process.env.ELEVENLABS_API_KEY || config.elevenLabsApiKey || "").trim();
    const defaultVoiceId = String(
      config.elevenLabsVoiceId
      || (typeof getDefaultVoiceId === "function" ? getDefaultVoiceId() : "")
      || findRecentVoiceId(workDir)
      || ""
    ).trim();
    if (!apiKey) throw httpError(400, "ElevenLabs API Key 未配置。");
    const headers = { "xi-api-key": apiKey, Accept: "application/json" };
    let response = await fetchImpl("https://api.elevenlabs.io/v1/voices", { headers });
    let body = await readJsonSafe(response);
    if (!response.ok || !Array.isArray(body.voices) || !body.voices.length) {
      const fallback = await fetchImpl("https://api.elevenlabs.io/v2/voices?page_size=100", { headers });
      const fallbackBody = await readJsonSafe(fallback);
      if (fallback.ok && Array.isArray(fallbackBody.voices) && fallbackBody.voices.length) {
        response = fallback;
        body = fallbackBody;
      }
    }
    if (!response.ok) {
      const detail = voiceErrorDetail(body);
      if (Number(response.status) === 401 && /voices_read/i.test(detail)) {
        const fallback = fallbackVoices(defaultVoiceId);
        return {
          voices: fallback,
          defaultVoiceId,
          modelId: NOVEL_TTS_MODEL_ID,
          modelName: NOVEL_TTS_MODEL_NAME,
          filters: buildVoiceFilters(fallback),
          restricted: true,
          warning: "当前 ElevenLabs Key 没有声音列表权限（voices_read）。已带入最近用过的声音和常用声音，也可手动填写 Voice ID。"
        };
      }
      throw httpError(response.status || 502, `读取 ElevenLabs 声音失败：${detail || response.status}`);
    }
    const voices = (Array.isArray(body.voices) ? body.voices : []).map(mapVoice).filter((voice) => voice.id);
    if (!voices.length) {
      const fallback = fallbackVoices(defaultVoiceId);
      return {
        voices: fallback,
        defaultVoiceId,
        modelId: NOVEL_TTS_MODEL_ID,
        modelName: NOVEL_TTS_MODEL_NAME,
        filters: buildVoiceFilters(fallback),
        restricted: true,
        warning: "ElevenLabs 没有返回声音列表。已带入最近用过的声音和常用声音，也可手动填写 Voice ID。"
      };
    }
    return {
      voices,
      defaultVoiceId,
      modelId: NOVEL_TTS_MODEL_ID,
      modelName: NOVEL_TTS_MODEL_NAME,
      filters: buildVoiceFilters(voices)
    };
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
      size: buffer.length,
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

  return { list, get, resolveAudioPath, generateFromMarketing, generateFromOptimizedScript, generateFromScript, listVoices, getVoice, previewVoiceAudio, prepareTaskBatch };
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

function mapVoice(voice = {}) {
  const labels = voice.labels && typeof voice.labels === "object" ? voice.labels : {};
  const languages = uniqueStrings([
    ...languageCodes(voice.verified_languages),
    labels.language,
    labels.accent
  ].map(normalizeLanguage)).filter(Boolean);
  const category = normalizeCategory(voice.category);
  const gender = normalizeGender(labels.gender);
  const age = normalizeAge(labels.age);
  return {
    id: String(voice.voice_id || voice.id || "").trim(),
    name: String(voice.name || voice.voice_id || "未命名声音").trim(),
    category,
    categoryLabel: CATEGORY_LABELS[category] || category,
    gender,
    genderLabel: GENDER_LABELS[gender] || gender,
    age,
    ageLabel: AGE_LABELS[age] || age,
    languages,
    languageLabels: languages.map((code) => LANGUAGE_LABELS[code] || code),
    previewUrl: String(voice.preview_url || voice.previewUrl || "").trim()
  };
}

function buildVoiceFilters(voices = []) {
  return {
    languages: uniqueOptions(voices.flatMap((voice) => (voice.languages || []).map((value, index) => ({
      value,
      label: voice.languageLabels?.[index] || LANGUAGE_LABELS[value] || value
    })))),
    categories: uniqueOptions(voices.filter((voice) => voice.category).map((voice) => ({
      value: voice.category,
      label: voice.categoryLabel || CATEGORY_LABELS[voice.category] || voice.category
    }))),
    genders: uniqueOptions(voices.filter((voice) => voice.gender).map((voice) => ({
      value: voice.gender,
      label: voice.genderLabel || GENDER_LABELS[voice.gender] || voice.gender
    }))),
    ages: uniqueOptions(voices.filter((voice) => voice.age).map((voice) => ({
      value: voice.age,
      label: voice.ageLabel || AGE_LABELS[voice.age] || voice.age
    })))
  };
}

function languageCodes(verified = []) {
  return (Array.isArray(verified) ? verified : []).flatMap((item) => [
    item?.language,
    String(item?.locale || "").split("-")[0]
  ]);
}

function normalizeLanguage(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (LANGUAGE_ALIASES[text]) return LANGUAGE_ALIASES[text];
  if (LANGUAGE_LABELS[text]) return text;
  return text.slice(0, 24);
}

function normalizeCategory(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "premade" || text === "cloned" || text === "generated" || text === "professional" || text === "saved") return text;
  return text;
}

function normalizeGender(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "male" || text === "female" || text === "neutral") return text;
  return "";
}

function normalizeAge(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (text === "young" || text === "old") return text;
  if (text === "middle_aged" || text === "middle" || text === "middleaged") return "middle_aged";
  return "";
}

function uniqueOptions(items) {
  const seen = new Set();
  return items.filter((item) => {
    const value = String(item?.value || "").trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  }).sort((left, right) => String(left.label).localeCompare(String(right.label), "zh-Hans-CN"));
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

const LANGUAGE_LABELS = {
  en: "English", zh: "Chinese", ja: "Japanese", ko: "Korean", es: "Spanish", fr: "French",
  de: "German", pt: "Portuguese", it: "Italian", hi: "Hindi", ar: "Arabic", id: "Indonesian",
  nl: "Dutch", pl: "Polish", ru: "Russian", tr: "Turkish", vi: "Vietnamese", th: "Thai"
};

const LANGUAGE_ALIASES = {
  english: "en", chinese: "zh", japanese: "ja", korean: "ko", spanish: "es", french: "fr",
  german: "de", portuguese: "pt", italian: "it", hindi: "hi", arabic: "ar", american: "en",
  british: "en", australian: "en", "en-us": "en", "en-gb": "en", "zh-cn": "zh"
};

const CATEGORY_LABELS = {
  premade: "官方音色",
  cloned: "克隆音色",
  generated: "生成音色",
  professional: "专业音色",
  saved: "最近使用"
};

const GENDER_LABELS = { male: "男性", female: "女性", neutral: "中性" };
const AGE_LABELS = { young: "青年", middle_aged: "中年", old: "老年" };

function fallbackVoices(defaultVoiceId) {
  const saved = String(defaultVoiceId || "").trim();
  const items = saved ? [mapVoice({ voice_id: saved, name: "最近使用的声音", category: "saved" })] : [];
  for (const voice of [
    { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade", labels: { gender: "female", age: "young", language: "en" } },
    { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", category: "premade", labels: { gender: "female", age: "young", language: "en" } },
    { voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam", category: "premade", labels: { gender: "male", age: "middle_aged", language: "en" } },
    { voice_id: "JBFqnCBsd6RMkjVDRZzb", name: "George", category: "premade", labels: { gender: "male", age: "middle_aged", language: "en" } },
    { voice_id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", category: "premade", labels: { gender: "male", age: "middle_aged", language: "en" } }
  ]) {
    const mapped = mapVoice(voice);
    if (!items.some((item) => item.id === mapped.id)) items.push(mapped);
  }
  return items;
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
