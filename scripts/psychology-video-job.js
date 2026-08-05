import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readConfig } from "./video-core.js";
import { resolveStorageDirs } from "./storage-paths.js";

const root = process.cwd();
const payloadPath = process.argv[2];
const jobPath = process.argv[3];
if (!payloadPath || !jobPath) throw new Error("Missing psychology task payload or job path.");

const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
const aspectRatio = payload.aspectRatio === "9:16" ? "9:16" : "16:9";
const creativeVariant = Math.max(1, Number(payload.creativeVariant) || 1);
const config = readConfig(root);
const { outputDir, workDir } = resolveStorageDirs(root, config);
const savedSettings = readOptionalJson(path.join(workDir, "psychology-video-settings.json"));
const jobDir = path.join(workDir, "psychology", safeName(payload.jobId || `psychology-${Date.now()}`));
const cacheDir = path.join(workDir, "psychology", "audio-cache");
fs.mkdirSync(jobDir, { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const results = [];

main().catch((error) => {
  patchJob({ status: "failed", percent: 100, message: String(error?.message || error), error: String(error?.stack || error), results });
  process.exitCode = 1;
});

async function main() {
  const kieApiKey = String(process.env.KIE_API_KEY || savedSettings.kieApiKey || config.kieApiKey || "").trim();
  const elevenLabsApiKey = String(process.env.ELEVENLABS_API_KEY || savedSettings.elevenLabsApiKey || config.elevenLabsApiKey || "").trim();
  const voiceId = String(payload.elevenLabsVoiceId || savedSettings.elevenLabsVoiceId || config.elevenLabsVoiceId || "").trim();
  if (!kieApiKey) throw new Error("Kie.ai API Key 未配置。");
  if (!elevenLabsApiKey) throw new Error("ElevenLabs API Key 未配置。");
  if (!voiceId) throw new Error("ElevenLabs Voice ID 未配置。");

  patchJob({ status: "running", percent: 3, message: "正在准备短钩子配音与测试画面..." });
  const sourceImageUrl = String(payload.sourceImageUrl || "").trim();
  const narration = String(payload.narration || "").trim() || normalizeHookNarration(await generateNarration(kieApiKey));
  const imagePrompt = sourceImageUrl ? String(payload.imagePrompt || "").trim() : (String(payload.imagePrompt || "").trim() || await generateImagePrompt(kieApiKey));
  const narrationAudioPath = await synthesizeSpeech({ text: narration, apiKey: elevenLabsApiKey, voiceId });
  const narrationDuration = probeDuration(narrationAudioPath);
  const targetDuration = Math.max(1, narrationDuration || Number(payload.durationSeconds) || 8);
  const audioPath = prepareAudioTrack({ narrationPath: narrationAudioPath, duration: targetDuration });
  const duration = probeDuration(audioPath) || targetDuration;
  const models = Array.isArray(payload.imageModels) && payload.imageModels.length ? payload.imageModels : ["nano-banana"];
  const target = Math.max(1, Math.min(300, Number(payload.totalVideos) || models.length));
  let downloadedSourceImage = "";

  for (let index = 0; index < target; index += 1) {
    const model = models[index % models.length];
    const variant = Math.floor(index / models.length) + 1;
    const imageSourceLabel = sourceImageUrl ? "题库原图" : modelLabel(model);
    patchJob({
      status: "running",
      progressCurrent: index,
      progressTotal: target,
      percent: Math.max(8, Math.round(8 + (index / target) * 86)),
      message: `正在生成 ${index + 1}/${target}：${imageSourceLabel}动效...`,
      narration,
      imagePrompt,
      results
    });

    let imageUrl = sourceImageUrl;
    let imagePath = downloadedSourceImage;
    if (!sourceImageUrl) {
      const variedPrompt = `${imagePrompt}\n\nCreative variation ${creativeVariant}, render ${variant}: Change the visual art direction, character appearance, environment, camera angle, lighting, and color palette substantially while preserving the same test choices. The result must be compositionally distinct from previous variants.\n\nMANDATORY: visuals only. Do not render any visible words, letters, numbers, captions, labels, logos, watermarks, signs, UI, or typography.`;
      const taskId = await createImageTask({ apiKey: kieApiKey, model, prompt: variedPrompt });
      imageUrl = await waitForImage({ apiKey: kieApiKey, taskId });
      imagePath = path.join(jobDir, `image-${String(index + 1).padStart(3, "0")}.png`);
      await downloadFile(imageUrl, imagePath);
    } else if (!downloadedSourceImage) {
      downloadedSourceImage = path.join(jobDir, "source-test-image.png");
      await downloadFile(sourceImageUrl, downloadedSourceImage);
      imagePath = downloadedSourceImage;
    }

    const outputId = uniqueOutputId(safeName(`${payload.question.slice(0, 20)}-psychology-${sourceImageUrl ? "source" : model}-${variant}`));
    const outputPath = path.join(outputDir, `${outputId}.mp4`);
    renderVideo({ imagePath, audioPath, outputPath, duration, title: payload.hookTitle || payload.question, subtitle: narration, sourceStyle: Boolean(sourceImageUrl) });
    results.push({
      id: outputId,
      fileName: path.basename(outputPath),
      videoUrl: `/outputs/${encodeURIComponent(path.basename(outputPath))}`,
      template: "psychology-motion",
      templateLabel: `心理学测试 · ${imageSourceLabel}`,
      imageModel: sourceImageUrl ? "source-image" : model,
      imageUrl,
      narration,
      imagePrompt,
      duration
    });
  }
  patchJob({ status: "done", percent: 100, progressCurrent: target, progressTotal: target, message: `心理学视频生成完成，共 ${results.length} 条。`, results, narration, imagePrompt });
}

async function generateNarration(apiKey) {
  const prompt = [
    "Write a concise English voiceover for a TikTok visual psychology test.",
    `Question: ${payload.question}`,
    payload.answerGuide ? `Context only: ${payload.answerGuide}` : "Ask the viewer to inspect the image and choose instinctively.",
    `Creative variation ${creativeVariant}: use a noticeably different curiosity angle, opening wording, and CTA phrasing from other versions of this topic.`,
    "Use exactly two short natural sentences and 16 to 30 words total.",
    "Sentence one must create curiosity and ask the viewer to choose what they noticed or preferred.",
    "Sentence two must use exactly one interaction CTA. Choose one naturally: tap the link in the bottom-left to take the test, take the full test on the profile, or comment A, B, C, or D.",
    "Do not explain the result, list choice meanings, greet the viewer, add headings, labels, quotation marks, or markdown.",
    "Return only the exact voiceover ready for text-to-speech."
  ].join("\n");
  return kieChat(apiKey, prompt);
}

function normalizeHookNarration(value) {
  const source = String(value || "").replace(/^[\s"“”']+|[\s"“”']+$/g, "").replace(/\s+/g, " ").trim();
  if (!source) return "Look closely and choose the image that feels right. Comment A, B, C, or D below.";
  const sentences = source.match(/[^.!?。！？]+[.!?。！？]?/g)?.map((item) => item.trim()).filter(Boolean) || [source];
  const concise = sentences.slice(0, 2).join(" ");
  const words = concise.split(/\s+/);
  if (words.length > 36) return `${words.slice(0, 36).join(" ").replace(/[,:;.!?]+$/g, "")}.`;
  return /[.!?。！？]$/.test(concise) ? concise : `${concise}.`;
}
async function generateImagePrompt(apiKey) {
  const layoutInstruction = aspectRatio === "16:9"
    ? "Arrange exactly four equal visual choices in one horizontal row from left to right. Each choice must stay centered inside its own quarter of the canvas. Use a clean light neutral background and do not leave a large title area."
    : "Arrange exactly four visual choices in a clean balanced 2x2 composition. Leave clear space near the top for a title added in post-production.";
  const prompt = [
    `Create one production-ready English image-generation prompt for a TikTok visual psychology test in ${aspectRatio === "16:9" ? "landscape 16:9" : "vertical 9:16"}.`,
    `Test topic: ${payload.question}`,
    `Creative variation ${creativeVariant}: choose a substantially different art direction, composition, lighting, color palette, and character or object treatment from other versions of this same topic.`,
    payload.answerGuide ? `Choice guidance: ${payload.answerGuide}` : "Design four visually distinct choices.",
    layoutInstruction,
    "The four choices must be instantly understandable from imagery alone, visually balanced, premium, high contrast, and suitable for a viral psychology quiz.",
    "Do not request text, letters, numbers, labels, logos, watermarks, captions, UI, borders, or typography inside the image.",
    "Return only the prompt."
  ].join("\n");
  return kieChat(apiKey, prompt);
}
async function kieChat(apiKey, prompt) {
  const response = await fetch("https://api.kie.ai/gemini-3-5-flash-openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: prompt }] }], stream: false, include_thoughts: false, reasoning_effort: "medium" })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(kieError(data, `Kie AI 文案请求失败：HTTP ${response.status}`));
  const text = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("Kie AI 没有返回可用文本。");
  return text;
}

async function createImageTask({ apiKey, model, prompt }) {
  const modelId = model === "grok" ? "grok-imagine/text-to-image" : "google/nano-banana";
  const input = model === "grok"
    ? { prompt, aspect_ratio: aspectRatio }
    : { prompt, aspect_ratio: aspectRatio, output_format: "png" };
  const response = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelId, input })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (Number(data.code) && Number(data.code) !== 200)) throw new Error(kieError(data, `Kie 生图任务创建失败：HTTP ${response.status}`));
  const taskId = String(data?.data?.taskId || "");
  if (!taskId) throw new Error("Kie 生图接口没有返回任务 ID。");
  return taskId;
}

async function waitForImage({ apiKey, taskId }) {
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(kieError(data, `Kie 生图状态查询失败：HTTP ${response.status}`));
    const details = data?.data || {};
    const state = String(details.state || "waiting").toLowerCase();
    if (["fail", "failed", "error"].includes(state)) throw new Error(String(details.failMsg || details.failCode || "Kie 生图失败。"));
    if (["success", "succeeded", "done", "completed"].includes(state)) {
      const parsed = parseResultJson(details.resultJson);
      if (!parsed.length) throw new Error("Kie 生图完成，但没有返回图片地址。");
      return parsed[0];
    }
  }
  throw new Error("Kie 生图等待超过 12 分钟，任务已停止。");
}

async function synthesizeSpeech({ text, apiKey, voiceId }) {
  const cacheKey = crypto.createHash("sha256").update(JSON.stringify({ text, voiceId, model: payload.elevenLabsModelId || "eleven_multilingual_v2" })).digest("hex");
  const audioPath = path.join(cacheDir, `${cacheKey}.mp3`);
  if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1024) return audioPath;
  patchJob({ status: "running", percent: 7, message: "正在使用 ElevenLabs 生成解说音频..." });
  const outputFormat = payload.elevenLabsOutputFormat || config.elevenLabsOutputFormat || "mp3_44100_128";
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: payload.elevenLabsModelId || config.elevenLabsModelId || "eleven_multilingual_v2" })
  });
  if (!response.ok) throw new Error(`ElevenLabs 配音失败：${await response.text()}`);
  fs.writeFileSync(audioPath, Buffer.from(await response.arrayBuffer()));
  return audioPath;
}

function prepareAudioTrack({ narrationPath, duration }) {
  const musicDir = String(payload.backgroundMusicDir || savedSettings.backgroundMusicDir || "").trim();
  const musicFiles = listAudioFiles(musicDir);
  const outputPath = path.join(jobDir, "final-audio.m4a");
  const safeDuration = Math.max(1, Number(duration) || 8);
  const fadeStart = Math.max(0, safeDuration - 1);

  if (!musicFiles.length) {
    run("ffmpeg", ["-y", "-hide_banner", "-i", narrationPath, "-af", `apad=pad_dur=${safeDuration.toFixed(3)},atrim=0:${safeDuration.toFixed(3)}`, "-c:a", "aac", "-b:a", "192k", outputPath]);
    return outputPath;
  }

  const musicPath = musicFiles[Math.floor(Math.random() * musicFiles.length)];
  const volume = Math.max(0, Math.min(0.5, Number(payload.backgroundMusicVolume ?? savedSettings.backgroundMusicVolume ?? 0.10)));
  const filter = `[0:a]apad=pad_dur=${safeDuration.toFixed(3)},volume=1[narration];[1:a]volume=${volume.toFixed(3)},afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeStart.toFixed(3)}:d=1[bgm];[narration][bgm]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,atrim=0:${safeDuration.toFixed(3)}[audio]`;
  run("ffmpeg", ["-y", "-hide_banner", "-i", narrationPath, "-stream_loop", "-1", "-i", musicPath, "-filter_complex", filter, "-map", "[audio]", "-c:a", "aac", "-b:a", "192k", outputPath]);
  return outputPath;
}

function listAudioFiles(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current, depth = 0) => {
    if (depth > 2 || files.length >= 500) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath, depth + 1);
      else if (/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(entry.name)) files.push(fullPath);
    }
  };
  visit(directory);
  return files;
}
function renderLandscapeRemotion({ imagePath, audioPath, outputPath, duration, title, subtitle }) {
  const assetId = `${safeName(path.basename(outputPath, path.extname(outputPath)))}-${Date.now()}`;
  const assetDir = path.join(jobDir, `${assetId}-public`);
  fs.mkdirSync(assetDir, { recursive: true });
  const imageAssetName = `${assetId}.image${path.extname(imagePath) || ".png"}`;
  const audioAssetName = `${assetId}.audio${path.extname(audioPath) || ".m4a"}`;
  const imageAssetPath = path.join(assetDir, imageAssetName);
  const audioAssetPath = path.join(assetDir, audioAssetName);
  const propsPath = path.join(jobDir, `${assetId}.remotion-props.json`);

  fs.copyFileSync(imagePath, imageAssetPath);
  fs.copyFileSync(audioPath, audioAssetPath);
  fs.writeFileSync(propsPath, JSON.stringify({
    title: String(title || payload.question || "").trim(),
    subtitle: String(subtitle || "").trim(),
    imageSrc: imageAssetName,
    audioSrc: audioAssetName,
    duration
  }, null, 2), "utf8");

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = [
    "remotion",
    "render",
    cliPath(path.relative(root, path.join(root, "remotion", "index.jsx"))),
    "PsychologyLandscape",
    cliPath(outputPath),
    "--props",
    cliPath(propsPath),
    "--overwrite",
    "--public-dir",
    cliPath(assetDir),
    "--codec",
    "h264",
    "--crf",
    "21"
  ];

  try {
    run(command, args);
  } finally {
    try { fs.unlinkSync(propsPath); } catch { /* Keep cleanup best-effort. */ }
    try { fs.rmSync(assetDir, { recursive: true, force: true }); } catch { /* Keep cleanup best-effort. */ }
  }
}

function cliPath(value) {
  return String(value).replace(/\\/g, "/");
}

function renderVideo({ imagePath, audioPath, outputPath, duration, title, subtitle = "", sourceStyle = false }) {
  if (aspectRatio === "16:9") {
    renderLandscapeRemotion({ imagePath, audioPath, outputPath, duration, title, subtitle });
    return;
  }
  const fps = Math.max(24, Number(config.fps) || 30);
  const landscape = aspectRatio === "16:9";
  const width = landscape ? 1920 : 1080;
  const height = landscape ? 1080 : 1920;
  const titleFile = path.join(jobDir, `${path.basename(outputPath, ".mp4")}.title.txt`);
  const wrappedTitle = wrapTitle(title || payload.question || "", landscape ? 52 : 28);
  fs.writeFileSync(titleFile, wrappedTitle, "utf8");
  const titleY = Math.round(height * (Math.max(8, Math.min(55, Number(payload.titlePosition) || 14)) / 100));
  const fontSize = Math.max(42, Math.min(100, Number(payload.titleFontSize) || 68));
  const titleLines = Math.max(1, wrappedTitle.split("\n").length);
  const titleBoxHeight = titleLines * (fontSize + 10) + 52;
  const fontFile = filterPath(config.fontFile || "C:/Windows/Fonts/msyh.ttc");
  const textFile = filterPath(titleFile);
  const canvasColor = sourceStyle ? "white" : "0x0b0d10";
  const fittedImage = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${canvasColor}`;
  const motion = payload.motion === "none"
    ? fittedImage
    : payload.motion === "slow-zoom"
      ? `${fittedImage},zoompan=z='min(zoom+0.00018,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`
      : `${fittedImage},zoompan=z='1.065-0.035*cos(2*PI*on/(${fps}*4))':x='iw/2-(iw/zoom/2)+18*sin(2*PI*on/(${fps}*7))':y='ih/2-(ih/zoom/2)+12*cos(2*PI*on/(${fps}*5))':d=1:s=${width}x${height}:fps=${fps},rotate='0.006*sin(2*PI*t/6)':ow=iw:oh=ih:c=${canvasColor},eq=brightness='0.012*sin(2*PI*t/3)':contrast='1.03+0.02*sin(2*PI*t/4)':eval=frame`;
  const titleBackground = sourceStyle ? "white@0.90" : "black@0.48";  const titleColor = sourceStyle ? "black" : "white";
  const titleBorder = sourceStyle ? "white@0.9" : "black@0.85";
  const filters = [
    motion,
    "format=yuv420p",
    `drawbox=x=45:y=${Math.max(35, titleY - 34)}:w=990:h=${titleBoxHeight}:color=${titleBackground}:t=fill`,
    `drawtext=fontfile='${fontFile}':textfile='${textFile}':reload=0:x=(w-text_w)/2:y=${titleY}:fontsize=${fontSize}:fontcolor=${titleColor}:borderw=4:bordercolor=${titleBorder}:line_spacing=10`
  ].join(",");
  const codec = String(config.psychologyVideoCodec || config.videoCodec || "libx264");
  const args = ["-y", "-hide_banner", "-loop", "1", "-i", imagePath, "-i", audioPath, "-vf", filters, "-map", "0:v:0", "-map", "1:a:0", "-t", String(duration), "-shortest", "-r", String(fps), "-c:v", codec, "-pix_fmt", "yuv420p"];
  if (codec === "libx264") args.push("-preset", "veryfast", "-crf", "21");
  args.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath);
  run("ffmpeg", args);
}

function wrapTitle(value, maxWidth = 28) {
  const source = String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!source) return "心理测试";
  const lines = [];
  let line = "";
  let width = 0;
  for (const char of source) {
    const charWidth = /[\u0000-\u00ff]/.test(char) ? 1 : 2;
    if (line && width + charWidth > maxWidth) {
      lines.push(line.trim());
      if (lines.length === 3) {
        lines[2] = `${lines[2].replace(/[.。…]+$/g, "")}…`;
        return lines.join("\n");
      }
      line = "";
      width = 0;
    }
    line += char;
    width += charWidth;
  }
  if (line.trim() && lines.length < 3) lines.push(line.trim());
  return lines.join("\n");
}

async function downloadFile(url, filePath) {
  const attempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(45_000),
        headers: {
          accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "user-agent": "Mozilla/5.0 LocalFactory/1.0"
        }
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw error;
      }

      fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
      return;
    } catch (error) {
      lastError = error;
      const shouldRetry = error?.retryable !== false && attempt < attempts;
      if (!shouldRetry) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }

  let host = String(url || "");
  try {
    host = new URL(url).host;
  } catch {
    // Keep the original value when the URL cannot be parsed.
  }
  const code = lastError?.cause?.code || lastError?.code;
  const detail = [code, lastError?.message].filter(Boolean).join(" · ");
  throw new Error(`下载题目图片失败（${host}，已重试 ${attempts} 次）${detail ? `：${detail}` : ""}`);
}
function probeDuration(filePath) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? Number(String(result.stdout || "").trim()) : 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, shell: process.platform === "win32" && command.endsWith(".cmd"), maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}: ${(result.stderr || result.stdout || "").slice(0, 2400)}`);
}

function patchJob(patch) {
  const current = fs.existsSync(jobPath) ? JSON.parse(fs.readFileSync(jobPath, "utf8")) : {};
  fs.writeFileSync(jobPath, JSON.stringify({ ...current, ...patch, updatedAt: Date.now() }, null, 2), "utf8");
}

function uniqueOutputId(baseId) {
  let id = baseId;
  let suffix = 2;
  while (fs.existsSync(path.join(outputDir, `${id}.mp4`))) id = `${baseId}-${suffix++}`;
  return id;
}

function parseResultJson(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed?.resultUrls) ? parsed.resultUrls.map(String).filter(Boolean) : [];
  } catch { return []; }
}

function modelLabel(model) {
  return model === "grok" ? "Grok Imagine" : "Nano Banana";
}

function safeName(value) {
  return String(value || "psychology").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "psychology";
}

function filterPath(value) {
  return String(value).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function kieError(data, fallback) {
  return String(data?.msg || data?.message || data?.error || fallback);
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function readOptionalJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return {}; }
}
