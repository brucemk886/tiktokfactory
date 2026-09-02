import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createKieAiService } from "./kie-ai.js";
import {
  COLLAGE_SCORE_THRESHOLD,
  buildCollagePrompt,
  buildCollageRevisionPrompt,
  collageImagePrompt,
  parseCollagePlan,
  scoreCollagePlan,
} from "./psychology-collage-core.js";
import { readConfig } from "./video-core.js";
import { resolveStorageDirs } from "./storage-paths.js";

const root = process.cwd();
const payloadPath = process.argv[2];
const jobPath = process.argv[3];
if (!payloadPath || !jobPath) throw new Error("Missing psychology collage payload or job path.");
const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
const config = readConfig(root);
const { outputDir, workDir } = resolveStorageDirs(root, config);
const settings = readJson(path.join(workDir, "psychology-video-settings.json"));
const jobDir = path.join(workDir, "psychology-collage", safeName(payload.jobId || `psychology-${Date.now()}`));
const audioCacheDir = path.join(workDir, "psychology", "audio-cache");
const manifestPath = path.join(jobDir, "manifest.json");
const results = [];
const commands = [];
fs.mkdirSync(jobDir, { recursive: true });
fs.mkdirSync(audioCacheDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

main().catch((error) => {
  writeManifest({ status: "blocked", error: String(error?.message || error), outputs: results, commands });
  patchJob({ status: "failed", percent: 100, message: String(error?.message || error), error: String(error?.stack || error), results });
  process.exitCode = 1;
});

async function main() {
  const kieApiKey = String(process.env.KIE_API_KEY || settings.kieApiKey || config.kieApiKey || "").trim();
  const elevenLabsApiKey = String(process.env.ELEVENLABS_API_KEY || settings.elevenLabsApiKey || config.elevenLabsApiKey || "").trim();
  const voiceId = String(payload.elevenLabsVoiceId || settings.elevenLabsVoiceId || config.elevenLabsVoiceId || "").trim();
  if (!kieApiKey || !elevenLabsApiKey || !voiceId) throw new Error("请先完成 Kie、ElevenLabs 和 Voice ID 配置。");
  const targetDuration = clamp(Math.round(Number(payload.targetDuration) || 90), 60, 120);
  const sceneCount = clamp(Math.round(Number(payload.sceneCount) || 10), 8, 12);
  const totalVideos = clamp(Math.floor(Number(payload.totalVideos) || 1), 1, 3);
  const imageModel = payload.imageModel === "grok" ? "grok" : "nano-banana";
  const credit = String(payload.credit || "@心理学").trim().slice(0, 32) || "@心理学";
  const kie = createKieAiService({ workDir, readApiKey: () => kieApiKey });

  writeManifest({
    topic: payload.topic,
    language: "zh-CN",
    audience: "中文心理学、哲学与自我成长观众",
    format: "4:3 paper collage psychology narrative",
    status: "drafting",
    attempt: 1,
    provider: "elevenlabs",
    imageProvider: `kie:${imageModel}`,
    score: null,
    outputs: [],
  });
  patchJob({ status: "running", percent: 4, message: "正在生成 3 个钩子和 4:3 双语拼贴分镜..." });
  let plan = await requestPlan(kie, buildCollagePrompt({ ...payload, targetDuration, sceneCount, credit }), { sceneCount });
  let score = scoreCollagePlan(plan, { targetDuration });
  let attempt = 1;
  while (!score.passed && attempt < 3) {
    attempt += 1;
    patchJob({ status: "running", percent: 7 + attempt * 3, message: `分镜 ${score.score}/100，正在定向修订第 ${attempt} 版...`, score, plan });
    plan = await requestPlan(kie, buildCollageRevisionPrompt({ plan, score, targetDuration }), { sceneCount });
    score = scoreCollagePlan(plan, { targetDuration });
  }
  fs.writeFileSync(path.join(jobDir, "plan.json"), JSON.stringify({ plan, score, attempt }, null, 2), "utf8");
  if (score.score < COLLAGE_SCORE_THRESHOLD) throw new Error(`两次修订后仍为 ${score.score}/100，未达到 ${COLLAGE_SCORE_THRESHOLD} 分生产门槛。`);

  writeManifest({ status: "scored", attempt, score, plan });
  patchJob({ status: "running", percent: 16, message: `分镜已通过：${score.score}/100，开始分段中文配音...`, score, plan });
  const voiceSegments = [];
  for (let index = 0; index < plan.scenes.length; index += 1) {
    patchJob({ status: "running", percent: Math.round(16 + ((index + 1) / plan.scenes.length) * 18), message: `正在配音 ${index + 1}/${plan.scenes.length}...`, score, plan });
    const audioPath = await synthesizeSpeech({
      text: plan.scenes[index].zh,
      apiKey: elevenLabsApiKey,
      voiceId,
      modelId: payload.elevenLabsModelId || settings.elevenLabsModelId || "eleven_multilingual_v2",
    });
    voiceSegments.push({ ...plan.scenes[index], audioPath, duration: probeDuration(audioPath) || targetDuration / plan.scenes.length });
  }
  const narrationPath = concatenateNarration(voiceSegments);
  const rawDuration = probeDuration(narrationPath) || voiceSegments.reduce((sum, scene) => sum + scene.duration, 0);
  const audioPath = prepareAudio({ narrationPath, duration: rawDuration });
  const duration = probeDuration(audioPath) || rawDuration;
  const scale = duration / Math.max(.1, voiceSegments.reduce((sum, scene) => sum + scene.duration, 0));
  const timedScenes = voiceSegments.map((scene) => ({ ...scene, duration: Math.max(1, scene.duration * scale) }));
  writeManifest({ status: "voiced", attempt, score, plan: { ...plan, scenes: timedScenes }, duration });

  for (let variant = 1; variant <= totalVideos; variant += 1) {
    const imagePaths = [];
    for (let index = 0; index < timedScenes.length; index += 1) {
      const completed = (variant - 1) * timedScenes.length + index;
      const totalImages = totalVideos * timedScenes.length;
      patchJob({ status: "running", percent: Math.round(35 + ((completed + 1) / totalImages) * 40), progressCurrent: completed, progressTotal: totalImages, message: `正在生成拼贴画面 ${completed + 1}/${totalImages}...`, score, plan, results });
      const imagePath = path.join(jobDir, `variant-${variant}-scene-${String(index + 1).padStart(2, "0")}.png`);
      await generateImage(kie, imageModel, collageImagePrompt(timedScenes[index], { variant, sceneNumber: index + 1 }), imagePath);
      imagePaths.push(imagePath);
    }
    const outputId = uniqueOutputId(safeName(`心理学-${plan.title}-${variant}`));
    const outputPath = path.join(outputDir, `${outputId}.mp4`);
    patchJob({ status: "running", percent: 80, message: `正在合成第 ${variant}/${totalVideos} 条 4:3 成片...`, score, plan, results });
    renderVideo({ outputPath, audioPath, title: plan.title, credit, scenes: timedScenes.map((scene, index) => ({ ...scene, imagePath: imagePaths[index] })) });
    const verification = verifyVideo(outputPath);
    const contactSheetPath = path.join(outputDir, `${outputId}-contact-sheet.jpg`);
    makeContactSheet(outputPath, contactSheetPath, verification.duration);
    results.push({
      id: outputId,
      fileName: path.basename(outputPath),
      videoUrl: `/outputs/${encodeURIComponent(path.basename(outputPath))}`,
      contactSheetUrl: `/outputs/${encodeURIComponent(path.basename(contactSheetPath))}`,
      template: "psychology-paper-collage",
      templateLabel: "心理学",
      imageModel,
      title: plan.title,
      duration: verification.duration,
      score: score.score,
      verification,
    });
    writeManifest({ status: "verified", attempt, score, plan: { ...plan, scenes: timedScenes }, duration, outputs: results, commands, verification });
  }
  patchJob({ status: "done", percent: 100, progressCurrent: totalVideos, progressTotal: totalVideos, message: `心理学拼贴中视频完成，共 ${results.length} 条；${score.score}/100，解码通过。`, score, plan, results, manifestPath });
}

async function requestPlan(kie, prompt, { sceneCount }) {
  const task = await kie.createTask({ kind: "chat", prompt: String(prompt || "").slice(0, 7900) });
  return parseCollagePlan(task.resultText, { topic: payload.topic, sceneCount });
}

async function synthesizeSpeech({ text, apiKey, voiceId, modelId }) {
  const key = crypto.createHash("sha256").update(JSON.stringify({ text, voiceId, modelId })).digest("hex");
  const audioPath = path.join(audioCacheDir, `${key}.mp3`);
  if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1024) return audioPath;
  const outputFormat = payload.elevenLabsOutputFormat || config.elevenLabsOutputFormat || "mp3_44100_128";
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: modelId }),
  });
  if (!response.ok) throw new Error(`ElevenLabs 分段配音失败：HTTP ${response.status} ${await response.text()}`);
  fs.writeFileSync(audioPath, Buffer.from(await response.arrayBuffer()));
  if (fs.statSync(audioPath).size < 1024) throw new Error("ElevenLabs 返回的分段配音无效。");
  return audioPath;
}

function concatenateNarration(segments) {
  const listPath = path.join(jobDir, "narration-concat.txt");
  const outputPath = path.join(jobDir, "narration.m4a");
  fs.writeFileSync(listPath, segments.map((item) => `file '${path.resolve(item.audioPath).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c:a", "aac", "-b:a", "192k", outputPath]);
  return outputPath;
}

function prepareAudio({ narrationPath, duration }) {
  const outputPath = path.join(jobDir, "final-audio.m4a");
  const safeDuration = Math.max(1, Number(duration) || 90);
  const musicFiles = listAudioFiles(String(payload.backgroundMusicDir || settings.backgroundMusicDir || "").trim());
  if (!musicFiles.length) {
    run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", narrationPath, "-af", `apad=pad_dur=${safeDuration.toFixed(3)},atrim=0:${safeDuration.toFixed(3)}`, "-c:a", "aac", "-b:a", "192k", outputPath]);
    return outputPath;
  }
  const musicPath = musicFiles[Math.abs(hashNumber(payload.jobId || "psychology")) % musicFiles.length];
  const volume = clamp(Number(payload.backgroundMusicVolume ?? settings.backgroundMusicVolume ?? .10), 0, .5);
  const fadeStart = Math.max(0, safeDuration - 1.2);
  const filter = `[0:a]apad=pad_dur=${safeDuration.toFixed(3)},volume=1[n];[1:a]volume=${volume.toFixed(3)},afade=t=in:st=0:d=.6,afade=t=out:st=${fadeStart.toFixed(3)}:d=1.2[b];[n][b]amix=inputs=2:duration=longest:normalize=0,atrim=0:${safeDuration.toFixed(3)}[a]`;
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", narrationPath, "-stream_loop", "-1", "-i", musicPath, "-filter_complex", filter, "-map", "[a]", "-c:a", "aac", "-b:a", "192k", outputPath]);
  return outputPath;
}

async function generateImage(kie, model, prompt, outputPath) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      let task = await kie.createTask({ kind: "image", prompt: attempt === 1 ? prompt : `${prompt}\nRetry with clearer silhouettes and stronger negative space.`, imageModel: model, aspectRatio: "4:3" });
      const deadline = Date.now() + 12 * 60 * 1000;
      while (Date.now() < deadline) {
        if (task.status === "success") {
          const url = task.resultUrls?.[0];
          if (!url) throw new Error("Kie 生图完成，但没有返回图片地址。");
          const response = await fetch(url);
          if (!response.ok) throw new Error(`下载拼贴图失败：HTTP ${response.status}`);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length < 1024) throw new Error("下载的拼贴图无效。");
          fs.writeFileSync(outputPath, bytes);
          return;
        }
        if (task.status === "fail") throw new Error(task.error || "Kie 拼贴生图失败。");
        await sleep(3000);
        task = await kie.refreshTask(task.id);
      }
      throw new Error("Kie 拼贴生图等待超过 12 分钟。");
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Kie 拼贴生图失败。");
}

function listAudioFiles(directory) {
  if (!directory || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
  const files = [];
  const visit = (current, depth = 0) => {
    if (depth > 2 || files.length >= 500) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(filePath, depth + 1);
      else if (/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(entry.name)) files.push(filePath);
    }
  };
  visit(directory);
  return files.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function renderVideo({ outputPath, audioPath, title, credit, scenes }) {
  const assetId = `${safeName(path.basename(outputPath, path.extname(outputPath)))}-${Date.now()}`;
  const assetDir = path.join(jobDir, `${assetId}-public`);
  const propsPath = path.join(jobDir, `${assetId}.props.json`);
  fs.mkdirSync(assetDir, { recursive: true });
  const audioName = `${assetId}.audio${path.extname(audioPath) || ".m4a"}`;
  fs.copyFileSync(audioPath, path.join(assetDir, audioName));
  const sceneProps = scenes.map((scene, index) => {
    const imageName = `${assetId}.scene-${index + 1}${path.extname(scene.imagePath) || ".png"}`;
    fs.copyFileSync(scene.imagePath, path.join(assetDir, imageName));
    return { zh: scene.zh, en: scene.en, layout: scene.layout, duration: scene.duration, imageSrc: imageName };
  });
  fs.writeFileSync(propsPath, JSON.stringify({ title, credit, scenes: sceneProps, audioSrc: audioName }, null, 2), "utf8");
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = ["remotion", "render", cli(path.relative(root, path.join(root, "remotion", "index.jsx"))), "PsychologyNarrative", cli(outputPath), "--props", cli(propsPath), "--public-dir", cli(assetDir), "--overwrite", "--codec", "h264", "--crf", "20", "--concurrency", "1"];
  let lastError;
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try { run(command, args); return; }
      catch (error) {
        lastError = error;
        if (attempt === 1) patchJob({ status: "running", percent: 82, message: "首次合成失败，正在执行唯一一次低并发重试..." });
      }
    }
    throw lastError;
  } finally {
    try { fs.unlinkSync(propsPath); } catch {}
    try { fs.rmSync(assetDir, { recursive: true, force: true }); } catch {}
  }
}

function verifyVideo(filePath) {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath], { encoding: "utf8", windowsHide: true });
  commands.push(label("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath]));
  if (probe.status !== 0) throw new Error(`ffprobe 验证失败：${String(probe.stderr || probe.stdout).slice(-1200)}`);
  const data = JSON.parse(probe.stdout || "{}");
  const video = (data.streams || []).find((stream) => stream.codec_type === "video");
  const audio = (data.streams || []).find((stream) => stream.codec_type === "audio");
  const duration = Number(data.format?.duration || video?.duration || 0);
  if (!video || !audio) throw new Error("成片必须同时包含视频流和音频流。");
  if (Number(video.width) !== 1440 || Number(video.height) !== 1080) throw new Error(`成片不是 1440×1080：${video.width}×${video.height}`);
  if (duration < 45) throw new Error(`成片时长异常：${duration.toFixed(2)} 秒。`);
  const decode = spawnSync("ffmpeg", ["-v", "error", "-i", filePath, "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
  commands.push(label("ffmpeg", ["-v", "error", "-i", filePath, "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]));
  if (decode.status !== 0) throw new Error(`FFmpeg 解码失败：${String(decode.stderr || decode.stdout).slice(-1200)}`);
  return { passed: true, width: Number(video.width), height: Number(video.height), fps: fraction(video.avg_frame_rate || video.r_frame_rate), duration, videoCodec: video.codec_name, audioCodec: audio.codec_name, decoded: true };
}

function makeContactSheet(videoPath, outputPath, duration) {
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", videoPath, "-vf", `fps=1/${Math.max(1, duration / 5).toFixed(5)},scale=360:270,tile=5x1:padding=2:margin=2:color=black`, "-frames:v", "1", "-q:v", "3", outputPath]);
}
function probeDuration(filePath) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath], { encoding: "utf8", windowsHide: true });
  const duration = Number(String(result.stdout || "").trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}
function run(command, args) {
  commands.push(label(command, args));
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 失败：${String(result.stderr || result.stdout || "").slice(-1800)}`);
}
function label(command, args) { return [command, ...args].map((part) => /\s/.test(String(part)) ? JSON.stringify(String(part)) : String(part)).join(" "); }
function writeManifest(patch) { fs.writeFileSync(manifestPath, JSON.stringify({ ...readJson(manifestPath), ...patch, updatedAt: new Date().toISOString() }, null, 2), "utf8"); }
function patchJob(patch) { fs.writeFileSync(jobPath, JSON.stringify({ ...readJson(jobPath), ...patch, updatedAt: Date.now() }, null, 2), "utf8"); }
function readJson(filePath) { try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return {}; } }
function uniqueOutputId(base) { return `${base}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto.randomBytes(2).toString("hex")}`; }
function safeName(value) { return String(value || "psychology").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "psychology"; }
function cli(value) { return String(value).replace(/\\/g, "/"); }
function fraction(value) { const [a, b] = String(value || "0/1").split("/").map(Number); return b ? a / b : a || 0; }
function hashNumber(value) { return crypto.createHash("sha256").update(String(value || "")).digest().readUInt32BE(0); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || min)); }
