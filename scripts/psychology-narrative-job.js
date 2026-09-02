import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createKieAiService } from "./kie-ai.js";
import {
  NARRATIVE_SCORE_THRESHOLD,
  buildNarrationSegments,
  buildNarrativePlanPrompt,
  buildNarrativeRevisionPrompt,
  detectNarrationLanguage,
  imageAspectRatioForQuizType,
  narrativeStylePrompt,
  narrativeTtsProviderForText,
  normalizeNarrativeLanguage,
  parseNarrativePlan,
  PSYCHOLOGY_TARGET2_QUIZ_TYPES,
  quizTypeAllowsGeneratedMarks,
  scoreNarrativePlan,
} from "./psychology-narrative.js";
import { readConfig } from "./video-core.js";
import { resolveStorageDirs } from "./storage-paths.js";
import { DEFAULT_KOKORO_VOICE, KOKORO_VOICES, generateKokoroSpeech, isKokoroVoiceId } from "./kokoro-tts.js";

const root = process.cwd();
const payloadPath = process.argv[2];
const jobPath = process.argv[3];
if (!payloadPath || !jobPath) throw new Error("Missing psychology quiz payload or job path.");

const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
const config = readConfig(root);
const { outputDir, workDir } = resolveStorageDirs(root, config);
const settings = readOptionalJson(path.join(workDir, "psychology-video-settings.json"));
const jobDir = path.join(workDir, "psychology-narrative", safeName(payload.jobId || `psychology-${Date.now()}`));
const audioCacheDir = path.join(workDir, "psychology", "audio-cache");
const manifestPath = path.join(jobDir, "manifest.json");
const commands = [];
const results = [];

fs.mkdirSync(jobDir, { recursive: true });
fs.mkdirSync(audioCacheDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

main().catch((error) => {
  writeManifest({
    status: "blocked",
    error: String(error?.message || error),
    outputs: results,
    commands,
  });
  patchJob({
    status: "failed",
    percent: 100,
    message: String(error?.message || error),
    error: String(error?.stack || error),
    results,
  });
  process.exitCode = 1;
});

async function main() {
  const kieApiKey = String(process.env.KIE_API_KEY || settings.kieApiKey || config.kieApiKey || "").trim();
  if (!kieApiKey) throw new Error("Kie.ai API Key 未配置。");
  const requestedLanguage = normalizeNarrativeLanguage(payload.language || "en");
  const suppliedKokoroVoice = String(payload.kokoroVoice || "").trim();
  const kokoroVoice = isEnglishKokoroVoice(suppliedKokoroVoice) ? suppliedKokoroVoice : DEFAULT_KOKORO_VOICE;
  const elevenLabsApiKey = String(process.env.ELEVENLABS_API_KEY || settings.elevenLabsApiKey || config.elevenLabsApiKey || "").trim();
  const elevenLabsVoiceId = String(payload.elevenLabsVoiceId || settings.elevenLabsVoiceId || config.elevenLabsVoiceId || "").trim();
  const elevenLabsModelId = String(payload.elevenLabsModelId || settings.elevenLabsModelId || config.elevenLabsModelId || "eleven_multilingual_v2").trim();

  const targetDuration = clamp(Math.round(Number(payload.targetDuration) || 16), 12, 20);
  const imageModel = payload.imageModel === "grok" ? "grok" : "nano-banana";
  const totalVideos = clamp(Math.floor(Number(payload.totalVideos) || 1), 1, 3);
  const defaultCredit = requestedLanguage === "zh-CN" ? "一知心理课 一场心灵旅" : "PSYCHOLOGY LAB";
  const credit = String(payload.credit || defaultCredit).trim().slice(0, 24) || defaultCredit;
  const requestedLayout = ["single", "choices-4", "choices-6"].includes(payload.layout) ? payload.layout : "auto";
  const requestedQuizType = PSYCHOLOGY_TARGET2_QUIZ_TYPES.includes(payload.quizType) ? payload.quizType : "auto";
  const suppliedPlan = payload.plan && typeof payload.plan === "object"
    ? parseNarrativePlan(payload.plan, {
      topic: payload.topic,
      credit,
      layout: requestedLayout,
      quizType: requestedQuizType,
      language: requestedLanguage,
    })
    : null;
  const kie = createKieAiService({ workDir, readApiKey: () => kieApiKey });

  writeManifest({
    topic: payload.topic,
    language: requestedLanguage,
    audience: requestedLanguage === "zh-CN" ? "中文心理学测试中视频观众" : "English-speaking psychology quiz viewers",
    format: "16:9 psychology target 2 persistent-test-image quiz",
    status: "drafting",
    attempt: 1,
    provider: "auto",
    voice: null,
    imageProvider: `kie:${imageModel}`,
    error: null,
    score: null,
    outputs: [],
    commands: [],
  });
  patchJob({
    status: "running",
    error: null,
    results: [],
    percent: 5,
    message: suppliedPlan
      ? "正在复用已审核的心理学目标2脚本..."
      : "正在生成心理学目标2的钩子、解说和测试画面描述...",
  });

  let plan = suppliedPlan || await requestPlan(kie, buildNarrativePlanPrompt({
    topic: payload.topic,
    angle: payload.angle,
    script: payload.script,
    targetDuration,
    credit,
    layout: requestedLayout,
    quizType: requestedQuizType,
    language: requestedLanguage,
  }), { layout: requestedLayout, quizType: requestedQuizType, language: requestedLanguage });
  let score = scoreNarrativePlan(plan, { targetDuration });
  let attempt = 1;
  while (!score.passed && attempt < 3) {
    attempt += 1;
    patchJob({
      status: "running",
      percent: 8 + attempt * 3,
      message: `脚本评分 ${score.score}/100，正在针对 ${score.failedDimensions.join("、") || "节奏"} 修订第 ${attempt} 版...`,
      score,
      plan,
    });
    plan = await requestPlan(kie, buildNarrativeRevisionPrompt({ plan, score, targetDuration }), {
      layout: requestedLayout,
      quizType: requestedQuizType,
      language: requestedLanguage,
    });
    score = scoreNarrativePlan(plan, { targetDuration });
  }
  fs.writeFileSync(path.join(jobDir, "plan.json"), JSON.stringify({ plan, score, attempt }, null, 2), "utf8");
  if (!score.passed || score.score < NARRATIVE_SCORE_THRESHOLD) {
    throw new Error(`心理学测试脚本两次修订后仍为 ${score.score}/100，未达到 ${NARRATIVE_SCORE_THRESHOLD} 分生产门槛；未达标：${score.failedDimensions.join("、") || "整体质量"}。`);
  }

  const language = detectNarrationLanguage(plan.narration);
  const provider = narrativeTtsProviderForText(plan.narration);
  const voice = provider === "elevenlabs" ? elevenLabsVoiceId : kokoroVoice;
  if (provider === "elevenlabs" && (!elevenLabsApiKey || !elevenLabsVoiceId)) {
    throw new Error("检测到中文文案，请先配置 ElevenLabs API Key 和 Voice ID。英文文案会自动使用本机 Kokoro。");
  }
  writeManifest({ status: "scored", attempt, score, plan, language, provider, voice, model: provider === "elevenlabs" ? elevenLabsModelId : "kokoro-82m" });
  patchJob({
    status: "running",
    percent: 22,
    message: provider === "elevenlabs"
      ? `脚本已通过：${score.score}/100。检测到中文，正在通过 ElevenLabs 一次生成整段配音和时间戳...`
      : `脚本已通过：${score.score}/100。正在用本机 Kokoro 一次生成整段英文配音和时间戳...`,
    score,
    plan,
    language,
    ttsProvider: provider,
  });

  const timedNarration = await synthesizeTimedNarration({
    plan,
    provider,
    voice,
    apiKey: elevenLabsApiKey,
    modelId: elevenLabsModelId,
  });
  const rawDuration = timedNarration.duration || targetDuration;
  const audioPath = prepareAudioTrack({ narrationPath: timedNarration.audioPath, duration: rawDuration });
  const duration = probeDuration(audioPath) || rawDuration;
  const timedCaptions = scaleTimedCaptions(timedNarration.captions, rawDuration > 0 ? duration / rawDuration : 1);

  writeManifest({ status: "voiced", attempt, score, plan, language, provider, voice, duration, captionTimings: timedCaptions });
  patchJob({ status: "running", percent: 42, message: `整段解说完成（${duration.toFixed(1)} 秒），字幕时间已按真实语音时间戳对齐，开始生成测试图...`, score, plan, language, ttsProvider: provider, captionTimings: timedCaptions });

  for (let variant = 1; variant <= totalVideos; variant += 1) {
    patchJob({
      status: "running",
      percent: Math.round(42 + ((variant - 0.5) / totalVideos) * 36),
      progressCurrent: variant - 1,
      progressTotal: totalVideos,
      message: `正在生成第 ${variant}/${totalVideos} 张心理学测试图...`,
      score,
      plan,
      results,
    });
    const imagePath = path.join(jobDir, `variant-${variant}.png`);
    await generateSceneImage({
      kie,
      model: imageModel,
      prompt: narrativeStylePrompt(plan, { variant }),
      outputPath: imagePath,
      layout: plan.layout,
      quizType: plan.quizType,
      aspectRatio: imageAspectRatioForQuizType(plan.quizType),
    });

    patchJob({ status: "running", percent: Math.round(78 + ((variant - 0.4) / totalVideos) * 16), message: `正在合成第 ${variant}/${totalVideos} 条心理学中视频...`, score, plan, results });
    const outputId = uniqueOutputId(safeName(`心理学-目标2-${plan.title}-${variant}`));
    const outputPath = path.join(outputDir, `${outputId}.mp4`);
    renderQuizVideo({
      outputPath,
      audioPath,
      imagePath,
      title: plan.title,
      credit,
      layout: plan.layout,
      quizType: plan.quizType,
      choiceLabels: plan.choiceLabels,
      captions: timedCaptions,
      duration,
    });
    const verification = verifyVideo(outputPath);
    const contactSheetPath = path.join(outputDir, `${outputId}-contact-sheet.jpg`);
    makeContactSheet(outputPath, contactSheetPath, verification.duration);
    results.push({
      id: outputId,
      fileName: path.basename(outputPath),
      videoUrl: `/outputs/${encodeURIComponent(path.basename(outputPath))}`,
      contactSheetFileName: path.basename(contactSheetPath),
      contactSheetUrl: `/outputs/${encodeURIComponent(path.basename(contactSheetPath))}`,
      template: "psychology-target-2",
      templateLabel: "心理学 · 目标2",
      imageModel,
      title: plan.title,
      quizType: plan.quizType,
      layout: plan.layout,
      duration: verification.duration,
      score: score.score,
      language,
      ttsProvider: provider,
      ttsVoice: voice,
      captionTimings: timedCaptions,
      verification,
    });
    writeManifest({ status: "verified", attempt, score, plan, language, provider, voice, duration, captionTimings: timedCaptions, outputs: results, commands, verification, error: null });
  }

  patchJob({
    status: "done",
    error: null,
    percent: 100,
    progressCurrent: totalVideos,
    progressTotal: totalVideos,
    message: `心理学目标2生成完成，共 ${results.length} 条；脚本评分 ${score.score}/100，解码验证通过。`,
    score,
    plan,
    language,
    ttsProvider: provider,
    results,
    manifestPath,
  });
}

async function requestPlan(kie, prompt, { layout, quizType, language }) {
  const task = await kie.createTask({ kind: "chat", prompt });
  return parseNarrativePlan(task.resultText, { topic: payload.topic, credit: payload.credit, layout, quizType, language });
}

async function synthesizeTimedNarration({ plan, provider, voice, apiKey, modelId }) {
  const sourceSegments = buildNarrationSegments(plan);
  if (sourceSegments.length < 2) throw new Error("心理学目标2至少需要两句可配音口播。");
  patchJob({
    status: "running",
    percent: 30,
    message: provider === "elevenlabs"
      ? "正在请求一次 ElevenLabs 中文整段配音与字符时间戳..."
      : "正在启动一次本机 Kokoro 英文整段配音并读取词时间戳...",
  });
  const speech = await synthesizeSpeech({
    text: plan.narration,
    provider,
    voice,
    apiKey,
    modelId,
    minimumCharacters: 2,
  });
  const audioPath = speech.path;
  const measuredDuration = Number(speech.duration) || probeDuration(audioPath);
  if (!(measuredDuration > 0)) throw new Error("整段配音没有有效时长。");
  const captions = provider === "elevenlabs"
    ? captionsFromCharacterAlignment(sourceSegments, speech.alignment, measuredDuration)
    : captionsFromWordTimings(sourceSegments, speech.words, measuredDuration);
  fs.writeFileSync(path.join(jobDir, "caption-timings.json"), JSON.stringify(captions, null, 2), "utf8");
  return { audioPath, duration: measuredDuration, captions };
}

async function synthesizeSpeech({ text, provider, voice, apiKey, modelId, minimumCharacters = 20 }) {
  const outputFormat = payload.elevenLabsOutputFormat || config.elevenLabsOutputFormat || "mp3_44100_128";
  const cacheKey = crypto.createHash("sha256").update(JSON.stringify({ provider, text, voice, modelId, outputFormat })).digest("hex");
  const cachedPath = path.join(audioCacheDir, `${cacheKey}.mp3`);
  const metadataPath = path.join(audioCacheDir, `${cacheKey}.json`);
  if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 1024) {
    const metadata = readOptionalJson(metadataPath);
    return { path: cachedPath, duration: probeDuration(cachedPath), words: metadata.words || [], alignment: metadata.alignment || null };
  }
  if (provider === "elevenlabs") {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=${encodeURIComponent(outputFormat)}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ text, model_id: modelId }),
    });
    if (!response.ok) throw new Error(`ElevenLabs 中文整段配音失败：HTTP ${response.status} ${(await response.text()).slice(0, 500)}`);
    const data = await response.json();
    const audio = Buffer.from(String(data.audio_base64 || ""), "base64");
    if (audio.length < 1024) throw new Error("ElevenLabs 返回的中文整段配音无效。");
    fs.writeFileSync(cachedPath, audio);
    const alignment = data.alignment || data.normalized_alignment || null;
    fs.writeFileSync(metadataPath, JSON.stringify({ provider, voice, modelId, text, alignment }, null, 2), "utf8");
    return { path: cachedPath, duration: probeDuration(cachedPath), alignment, words: [] };
  }
  const result = generateKokoroSpeech({
    text,
    voice,
    minimumCharacters,
    outDir: path.join(audioCacheDir, cacheKey),
    config,
  });
  if (!result?.mp3Path || !fs.existsSync(result.mp3Path)) throw new Error("本机 Kokoro 没有返回有效配音。");
  fs.copyFileSync(result.mp3Path, cachedPath);
  fs.writeFileSync(metadataPath, JSON.stringify({ provider, voice, text, words: result.words || [] }, null, 2), "utf8");
  return { path: cachedPath, duration: Number(result.duration) || probeDuration(cachedPath), words: result.words || [], alignment: null };
}

function captionsFromWordTimings(segments, words, duration) {
  const timedWords = (Array.isArray(words) ? words : []).filter((word) => Number.isFinite(Number(word?.start)) && Number.isFinite(Number(word?.end)));
  if (!timedWords.length) return proportionalCaptions(segments, duration);
  let cursor = 0;
  return segments.map((segment, index) => {
    const count = Math.max(1, String(segment.zh || "").trim().split(/\s+/).filter(Boolean).length);
    const startIndex = Math.min(cursor, timedWords.length - 1);
    const endIndex = index === segments.length - 1
      ? timedWords.length - 1
      : Math.min(timedWords.length - 1, cursor + count - 1);
    cursor = endIndex + 1;
    return {
      zh: segment.zh,
      en: segment.en,
      start: roundSeconds(Number(timedWords[startIndex].start)),
      end: roundSeconds(Math.max(Number(timedWords[endIndex].end), Number(timedWords[startIndex].start) + 0.1)),
    };
  });
}

function captionsFromCharacterAlignment(segments, alignment, duration) {
  const characters = Array.isArray(alignment?.characters) ? alignment.characters : [];
  const starts = Array.isArray(alignment?.character_start_times_seconds) ? alignment.character_start_times_seconds : [];
  const ends = Array.isArray(alignment?.character_end_times_seconds) ? alignment.character_end_times_seconds : [];
  if (!characters.length || starts.length !== characters.length || ends.length !== characters.length) {
    return proportionalCaptions(segments, duration);
  }
  const fullText = characters.join("");
  let searchFrom = 0;
  return segments.map((segment) => {
    let startIndex = fullText.indexOf(segment.zh, searchFrom);
    if (startIndex < 0) startIndex = searchFrom;
    let endIndex = Math.min(characters.length - 1, startIndex + Math.max(1, Array.from(segment.zh).length) - 1);
    while (startIndex < endIndex && /^\s$/u.test(characters[startIndex])) startIndex += 1;
    while (endIndex > startIndex && /^\s$/u.test(characters[endIndex])) endIndex -= 1;
    searchFrom = endIndex + 1;
    return {
      zh: segment.zh,
      en: segment.en,
      start: roundSeconds(Number(starts[startIndex]) || 0),
      end: roundSeconds(Math.max(Number(ends[endIndex]) || 0, Number(starts[startIndex]) + 0.1)),
    };
  });
}

function proportionalCaptions(segments, duration) {
  const weights = segments.map((segment) => Math.max(1, Array.from(String(segment.zh || "").replace(/\s/g, "")).length));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  return segments.map((segment, index) => {
    const start = cursor;
    cursor += index === segments.length - 1 ? duration - cursor : duration * (weights[index] / total);
    return { ...segment, start: roundSeconds(start), end: roundSeconds(cursor) };
  });
}

function isEnglishKokoroVoice(value) {
  const id = String(value || "").trim();
  return isKokoroVoiceId(id) && KOKORO_VOICES.some((voice) => voice.id === id && String(voice.language || "").startsWith("en"));
}

function scaleTimedCaptions(captions, scale) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return captions.map((item) => ({
    ...item,
    start: roundSeconds(Number(item.start) * safeScale),
    end: roundSeconds(Number(item.end) * safeScale),
  }));
}

function roundSeconds(value) {
  return Math.round(Math.max(0, Number(value) || 0) * 1000) / 1000;
}

function prepareAudioTrack({ narrationPath, duration }) {
  const outputPath = path.join(jobDir, "final-audio.m4a");
  const musicFiles = listAudioFiles(String(payload.backgroundMusicDir || settings.backgroundMusicDir || "").trim());
  const safeDuration = Math.max(1, Number(duration) || 16);
  if (!musicFiles.length) {
    run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", "-i", narrationPath,
      "-af", `apad=pad_dur=${safeDuration.toFixed(3)},atrim=0:${safeDuration.toFixed(3)}`,
      "-c:a", "aac", "-b:a", "192k", outputPath,
    ]);
    return outputPath;
  }

  const musicPath = musicFiles[Math.abs(hashNumber(payload.jobId || "psychology")) % musicFiles.length];
  const volume = clamp(Number(payload.backgroundMusicVolume ?? settings.backgroundMusicVolume ?? 0.10), 0, 0.5);
  const fadeStart = Math.max(0, safeDuration - 1);
  const filter = [
    `[0:a]apad=pad_dur=${safeDuration.toFixed(3)},volume=1[narration]`,
    `[1:a]volume=${volume.toFixed(3)},afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeStart.toFixed(3)}:d=1[bgm]`,
    `[narration][bgm]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,atrim=0:${safeDuration.toFixed(3)}[audio]`,
  ].join(";");
  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", narrationPath, "-stream_loop", "-1", "-i", musicPath,
    "-filter_complex", filter, "-map", "[audio]",
    "-c:a", "aac", "-b:a", "192k", outputPath,
  ]);
  return outputPath;
}

async function generateSceneImage({ kie, model, prompt, outputPath, layout, quizType, aspectRatio }) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      let task = await kie.createTask({
        kind: "image",
        prompt: attempt === 1 ? prompt : `${prompt}\nRetry with a clearer focal subject, stricter option count, and stronger ${aspectRatio || "16:9"} composition.`,
        imageModel: model,
        aspectRatio: aspectRatio || "16:9",
        noImageText: !quizTypeAllowsGeneratedMarks(quizType),
      });
      const deadline = Date.now() + 12 * 60 * 1000;
      while (Date.now() < deadline) {
        if (task.status === "success") {
          const imageUrl = task.resultUrls?.[0];
          if (!imageUrl) throw new Error("Kie 生图完成，但没有返回图片地址。");
          await downloadFile(imageUrl, outputPath);
          return;
        }
        if (task.status === "fail") throw new Error(task.error || "Kie 心理学测试生图失败。");
        await sleep(3000);
        task = await kie.refreshTask(task.id);
      }
      throw new Error("Kie 心理学测试生图等待超过 12 分钟。");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Kie ${layout || "single"} 测试图生成失败。`);
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载测试图失败：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024) throw new Error("下载的测试图文件无效。");
  fs.writeFileSync(outputPath, bytes);
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

function renderQuizVideo({ outputPath, audioPath, imagePath, title, credit, layout, quizType, choiceLabels, captions, duration }) {
  const assetId = `${safeName(path.basename(outputPath, path.extname(outputPath)))}-${Date.now()}`;
  const assetDir = path.join(jobDir, `${assetId}-public`);
  const propsPath = path.join(jobDir, `${assetId}.remotion-props.json`);
  fs.mkdirSync(assetDir, { recursive: true });

  const audioName = `${assetId}.audio${path.extname(audioPath) || ".m4a"}`;
  const imageName = `${assetId}.image${path.extname(imagePath) || ".png"}`;
  fs.copyFileSync(audioPath, path.join(assetDir, audioName));
  fs.copyFileSync(imagePath, path.join(assetDir, imageName));
  fs.writeFileSync(propsPath, JSON.stringify({
    title,
    credit,
    layout,
    quizType,
    choiceLabels,
    captions,
    imageSrc: imageName,
    audioSrc: audioName,
    duration,
  }, null, 2), "utf8");

  const remotionCli = path.join(root, "node_modules", "@remotion", "cli", "remotion-cli.js");
  if (!fs.existsSync(remotionCli)) throw new Error("Remotion CLI 不存在，请先安装项目依赖。");
  const args = [
    remotionCli, "render",
    path.join(root, "remotion", "index.jsx"),
    "PsychologyLandscape",
    outputPath,
    "--props=" + propsPath,
    "--public-dir=" + assetDir,
    "--overwrite",
    "--codec", "h264",
    "--crf", "20",
    "--concurrency", "1",
  ];
  const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (fs.existsSync(chromePath)) args.push("--browser-executable", chromePath);
  let lastError;
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        run(process.execPath, args);
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 1) patchJob({ status: "running", percent: 84, message: "首次合成失败，正在执行唯一一次低并发重试..." });
      }
    }
    throw lastError;
  } finally {
    try { fs.unlinkSync(propsPath); } catch {}
    try { fs.rmSync(assetDir, { recursive: true, force: true }); } catch {}
  }
}

function verifyVideo(filePath) {
  const probe = spawnSync("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", filePath,
  ], { encoding: "utf8", windowsHide: true });
  commands.push(commandLabel("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath]));
  if (probe.status !== 0) throw new Error(`ffprobe 验证失败：${String(probe.stderr || probe.stdout).slice(-1200)}`);
  const data = JSON.parse(probe.stdout || "{}");
  const video = (data.streams || []).find((stream) => stream.codec_type === "video");
  const audio = (data.streams || []).find((stream) => stream.codec_type === "audio");
  const duration = Number(data.format?.duration || video?.duration || audio?.duration || 0);
  if (!video || !audio) throw new Error("成片必须同时包含视频流和音频流。");
  if (Number(video.width) !== 1920 || Number(video.height) !== 1080) {
    throw new Error(`成片分辨率不是 1920×1080：${video.width}×${video.height}`);
  }
  if (!(duration >= 8)) throw new Error(`成片时长异常：${duration.toFixed(2)} 秒。`);

  const decode = spawnSync("ffmpeg", [
    "-v", "error", "-i", filePath, "-f", "null", "-",
  ], { encoding: "utf8", windowsHide: true });
  commands.push(commandLabel("ffmpeg", ["-v", "error", "-i", filePath, "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]));
  if (decode.status !== 0) throw new Error(`FFmpeg 解码验证失败：${String(decode.stderr || decode.stdout).slice(-1200)}`);

  return {
    passed: true,
    width: Number(video.width),
    height: Number(video.height),
    fps: fractionToNumber(video.avg_frame_rate || video.r_frame_rate),
    duration,
    videoCodec: video.codec_name,
    audioCodec: audio.codec_name,
    decoded: true,
  };
}

function makeContactSheet(videoPath, outputPath, duration) {
  const interval = Math.max(1, Number(duration) / 5);
  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-i", videoPath,
    "-vf", `fps=1/${interval.toFixed(5)},scale=384:216,tile=5x1:padding=2:margin=2:color=black`,
    "-frames:v", "1", "-q:v", "3", outputPath,
  ]);
}

function probeDuration(filePath) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath,
  ], { encoding: "utf8", windowsHide: true });
  const duration = Number(String(result.stdout || "").trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function run(command, args) {
  commands.push(commandLabel(command, args));
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} 执行失败：${String(result.stderr || result.stdout || "").slice(-1800)}`);
  }
}

function commandLabel(command, args) {
  return [command, ...args].map((part) => {
    const value = String(part);
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }).join(" ");
}

function writeManifest(patch) {
  const current = readOptionalJson(manifestPath);
  fs.writeFileSync(manifestPath, JSON.stringify({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }, null, 2), "utf8");
}

function patchJob(patch) {
  const current = readOptionalJson(jobPath);
  fs.writeFileSync(jobPath, JSON.stringify({
    ...current,
    ...patch,
    updatedAt: Date.now(),
  }, null, 2), "utf8");
}

function readOptionalJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function uniqueOutputId(base) {
  const suffix = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const token = crypto.randomBytes(2).toString("hex");
  return `${base}-${suffix}-${token}`;
}

function safeName(value) {
  return String(value || "psychology")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || "psychology";
}

function cliPath(value) {
  return String(value).replace(/\\/g, "/");
}

function fractionToNumber(value) {
  const [numerator, denominator] = String(value || "0/1").split("/").map(Number);
  return denominator ? numerator / denominator : numerator || 0;
}

function hashNumber(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest().readUInt32BE(0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}
