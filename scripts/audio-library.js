import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function createAudioLibraryService({ root, workDir, readConfig, fetchImpl = globalThis.fetch }) {
  const libraryDir = path.join(workDir, "audio-library");
  const filesDir = path.join(libraryDir, "files");
  const indexPath = path.join(libraryDir, "index.json");
  const inFlight = new Map();
  fs.mkdirSync(filesDir, { recursive: true });

  function list() {
    return readIndex(indexPath)
      .filter((item) => fs.existsSync(path.join(filesDir, item.fileName)))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
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

  async function synthesizeAndSave({ id, source, selected, script, apiKey, voiceId, modelId, outputFormat }) {
    const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text: script, model_id: modelId })
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
    const record = {
      id,
      title: String(selected.title || source?.source?.title || "未命名音频").trim(),
      fileName,
      createdAt: new Date().toISOString(),
      duration: probeDuration(outputPath, configFfprobe(readConfig(root))),
      size: buffer.length,
      scriptChars: script.length,
      modelId,
      source: { marketingId: source.id, rank: Number(selected.rank) || 0 }
    };
    const records = readIndex(indexPath).filter((item) => item.id !== id);
    records.push(record);
    writeJsonAtomic(indexPath, records);
    return { ...record, cacheHit: false };
  }

  return { list, get, resolveAudioPath, generateFromMarketing, prepareTaskBatch };
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
