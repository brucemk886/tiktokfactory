import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  VIDEO_EXTENSIONS,
  getAssetGroup,
  importExistingAssets,
  listMediaFiles,
  mustBeDirectory,
  probeDuration,
  readUsage,
  recordAssetUsage,
  round2,
  scoreClipReuse
} from "./asset-library.js";
import { resolveStorageDirs } from "./storage-paths.js";

const payloadPath = process.argv[2];
const jobPath = process.argv[3];
const root = process.cwd();
const bootConfig = readJson(path.join(root, "config.json"), {});
const storageDirs = resolveStorageDirs(root, bootConfig);
const defaultOutputDir = storageDirs.outputDir;
const workDir = path.join(storageDirs.workDir, "reddit-mix");
const captionCacheDir = path.join(storageDirs.workDir, "caption-cache");
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".opus", ".webm"];
const OVERLAY_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mov", ".mp4", ".webm"];

main().catch((error) => {
  patchJob({
    status: "failed",
    percent: 100,
    message: error.message || "Reddit 混剪失败。",
    updatedAt: Date.now()
  });
  process.exitCode = 1;
});

async function main() {
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const config = readJson(path.join(root, "config.json"));
  const audioDir = mustBeDirectory(payload.audioDir, "音频文件夹");
  const audios = listMediaFiles(audioDir, AUDIO_EXTENSIONS);
  const saveDir = resolveSaveDir(payload.saveDir);
  const backgroundMusicFiles = resolveBackgroundMusicFiles(payload.backgroundMusicDir);
  const legacyVariants = clampInt(payload.variants, 1, 20, 1);
  const width = Number(config.width) || 1080;
  const height = Number(config.height) || 1920;
  const fps = Number(config.fps) || 30;
  const autoCaptions = payload.autoCaptions !== false;
  const subtitleFontSize = clampInt(payload.subtitleFontSize, 42, 92, 62);
  const subtitleYPercent = clampNumber(payload.subtitleYPercent, 38, 82, 66);
  const subtitleAnimationMode = normalizeSubtitleAnimationMode(payload.subtitleAnimationMode);
  const groupId = String(payload.assetGroupId || "").trim();
  const dedup = normalizeDedupSettings(payload.dedup);
  const overlayFiles = resolveOverlayFiles(dedup.overlayDir);

  if (!audios.length) throw new Error("音频文件夹里没有找到可用音频。");

  ensureDir(defaultOutputDir);
  if (saveDir) ensureDir(saveDir);
  ensureDir(workDir);
  ensureDir(captionCacheDir);

  const group = resolveAssetGroup(payload, groupId);
  const videoMeta = (group.assets || [])
    .map((asset) => ({
      ...asset,
      file: asset.file,
      duration: Number(asset.duration) > 0 ? Number(asset.duration) : probeDuration(asset.file, 0)
    }))
    .filter((asset) => asset.file && fs.existsSync(asset.file) && asset.duration > 1);
  if (!videoMeta.length) throw new Error("No usable videos found in the video material folder.");

  const total = clampInt(payload.totalVideos, 1, 300, audios.length * legacyVariants);
  const results = [];
  const audioContexts = new Map();
  const skippedAudios = new Set();
  const warnings = [];
  let done = 0;
  let candidateIndex = 0;
  let failedVideos = 0;
  let attempts = 0;
  const maxAttempts = total + Math.max(20, Math.ceil(total * 0.5));

  while (done < total && attempts < maxAttempts) {
    attempts += 1;
    try {
    const audioIndex = candidateIndex % audios.length;
    const audioPath = audios[audioIndex];
    const variant = Math.floor(candidateIndex / audios.length) + 1;
    candidateIndex += 1;
    if (skippedAudios.has(audioPath)) continue;
    let audioContext = audioContexts.get(audioPath);
    if (!audioContext) {
      const audioDuration = probeDuration(audioPath, 0);
      if (audioDuration <= 0) throw new Error(`无法读取音频时长：${path.basename(audioPath)}`);
      let captions = null;
      if (autoCaptions) {
        patchJob({
          status: "running",
          percent: progress(done, total, 8),
          message: `识别字幕/读取缓存：${path.basename(audioPath)}`,
          progressCurrent: Math.min(total, done + 1),
          progressTotal: total,
          updatedAt: Date.now()
        });
        try {
          captions = (await getCachedOrTranscribeCaptions({
            audioPath,
            apiKey: process.env.ELEVENLABS_API_KEY || config.elevenLabsApiKey,
            modelId: config.elevenLabsSttModelId || "scribe_v2",
            requireWords: subtitleAnimationMode === "word-highlight"
          })).captions;
        } catch (error) {
          if (error?.code !== "EMPTY_TRANSCRIPT") throw error;
          const warning = `跳过无可用字幕的音频：${path.basename(audioPath)}`;
          skippedAudios.add(audioPath);
          warnings.push(warning);
          patchJob({
            status: "running",
            message: warning,
            warnings,
            progressCurrent: done,
            progressTotal: total,
            updatedAt: Date.now()
          });
          if (skippedAudios.size >= audios.length) throw new Error("所有音频都没有返回可用字幕，任务无法继续。");
          continue;
        }
      }
      audioContext = { audioDuration, captions };
      audioContexts.set(audioPath, audioContext);
    }
    const { audioDuration, captions } = audioContext;

    const baseId = safeFileName(`${path.basename(audioPath, path.extname(audioPath)).slice(0, 24)}-reddit-${variant}`);
    const id = uniqueOutputId(baseId);
    const runDir = path.join(workDir, `${id}-${Date.now()}`);
    ensureDir(runDir);

    patchJob({
      status: "running",
      percent: progress(done, total, 12),
      message: `抽取素材组：${group.name || group.id}，${path.basename(audioPath)} 第 ${variant} 轮`,
      progressCurrent: Math.min(total, done + 1),
      progressTotal: total,
      updatedAt: Date.now()
    });

    const segmentSeconds = resolveSegmentSeconds(payload, audioDuration);
    const usage = readUsage(root);
    const clips = pickClips({ videoMeta, audioDuration, segmentSeconds, usage });
    const concatVideo = path.join(runDir, "mixed-video.mp4");
    const outputPath = path.join(defaultOutputDir, `${id}.mp4`);

    renderClips({ clips, videoMeta, usage, runDir, concatVideo, width, height, fps, quality: payload.quality || "fast", dedup, overlayFiles, warnings });

    patchJob({
      status: "running",
      percent: progress(done, total, 62),
      message: `合成音频和字幕：${path.basename(audioPath)} 第 ${variant} 轮`,
      progressCurrent: Math.min(total, done + 1),
      progressTotal: total,
      updatedAt: Date.now()
    });

    const finalAudioPath = prepareAudioWithBackgroundMusic({
      audioPath,
      backgroundMusicFiles,
      runDir,
      duration: audioDuration,
      volume: clampNumber(payload.backgroundMusicVolume, 0, 1, 0.12)
    });

    muxAudioAndCaptions({
      inputVideo: concatVideo,
      audioPath: finalAudioPath,
      outputPath,
      captions,
      width,
      height,
      fontFile: config.fontFile || "C:/Windows/Fonts/msyh.ttc",
      subtitleFontSize,
      subtitleYPercent,
      subtitleAnimationMode,
      duration: audioDuration
    });

    const savedPath = saveDir ? copyToSaveDir(outputPath, saveDir) : "";

    recordAssetUsage(root, {
      groupId: group.id,
      outputId: id,
      audioName: path.basename(audioPath),
      clips
    });

    done += 1;
    results.push({
      id,
      audioName: path.basename(audioPath),
      audioIndex,
      variant,
      assetGroupId: group.id,
      assetGroupName: group.name || group.id,
      duration: audioDuration,
      videoUrl: `/outputs/${encodeURIComponent(path.basename(outputPath))}`,
      fileName: path.basename(outputPath),
      savedPath,
      clips: clips.map((clip) => ({
        assetId: clip.assetId,
        source: clip.fileName || path.basename(clip.file),
        start: round2(clip.start),
        duration: round2(clip.duration)
      }))
    });

    patchJob({
      status: "running",
      percent: progress(done, total, 0),
      message: `已完成 ${done}/${total}`,
      progressCurrent: done,
      progressTotal: total,
      results,
      warnings,
      updatedAt: Date.now()
    });
    cleanupRunDir(runDir);
    } catch (error) {
      failedVideos += 1;
      const reason = String(error?.message || error || "????").replace(/\s+/g, " ").slice(0, 1200);
      const warning = `???? ${attempts} ?????????${reason}`;
      warnings.push(warning);
      patchJob({
        status: "running",
        percent: progress(done, total, 0),
        message: `${warning}???????????`,
        progressCurrent: done,
        progressTotal: total,
        failedVideoCount: failedVideos,
        attempts,
        results,
        warnings,
        updatedAt: Date.now()
      });
    }
  }

  if (!results.length && failedVideos > 0) {
    throw new Error(`????????????? ${failedVideos} ???????${warnings.at(-1) || "????"}`);
  }
  if (done < total) {
    warnings.push(`???????? ${maxAttempts} ?????? ${done}/${total} ?????? ${failedVideos} ??`);
  }

  patchJob({
    status: "done",
    percent: 100,
    message: `Reddit 混剪完成：${results.length} 条视频。`,
    progressCurrent: results.length,
    progressTotal: total,
    results,
    warnings,
    failedVideoCount: failedVideos,
    attempts,
    updatedAt: Date.now()
  });
}

function resolveAssetGroup(payload, groupId) {
  const videoDirValue = String(payload.videoDir || "").trim();
  if (groupId) return getAssetGroup(root, groupId);
  const videoDir = mustBeDirectory(videoDirValue, "video material folder");
  const modeSuffix = payload.includeVideoSubfolders === false ? "flat" : "recursive";
  const result = importExistingAssets(root, {
    groupName: payload.fallbackGroupName || path.basename(videoDir),
    groupId: payload.fallbackGroupId || `${path.basename(videoDir)}-${modeSuffix}`,
    inputDir: videoDir,
    includeSubfolders: payload.includeVideoSubfolders !== false
  });
  return result.group;
}

function cleanupRunDir(runDir) {
  try {
    fs.rmSync(runDir, { recursive: true, force: true });
  } catch {
    // Keep rendering successful even if Windows still holds a temporary file handle.
  }
}

function resolveSaveDir(value) {
  const text = String(value || "").trim();
  return text ? path.resolve(text) : "";
}

function resolveBackgroundMusicFiles(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const dir = mustBeDirectory(text, "背景音乐文件夹");
  return listMediaFiles(dir, AUDIO_EXTENSIONS);
}

function resolveOverlayFiles(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const dir = mustBeDirectory(text, "蒙层素材文件夹");
  return listMediaFiles(dir, OVERLAY_EXTENSIONS);
}

function resolveSegmentSeconds(payload, audioDuration) {
  if (String(payload.segmentMode || "fixed") === "ratio") {
    const ratio = clampNumber(payload.segmentRatio, 1, 50, 10);
    return clampNumber(audioDuration * ratio / 100, 2, 18, 6);
  }
  return clampNumber(payload.segmentSeconds, 2, 18, 5);
}

function pickClips({ videoMeta, audioDuration, segmentSeconds, usage }) {
  const clips = [];
  let remaining = audioDuration;
  let guard = 0;
  let lastAssetId = "";

  while (remaining > 0.15 && guard < 400) {
    guard += 1;
    const duration = Math.min(segmentSeconds, remaining);
    const candidates = [];
    for (let i = 0; i < 24; i++) {
      const source = videoMeta[Math.floor(Math.random() * videoMeta.length)];
      if (!source || source.duration < duration + 0.15) continue;
      const maxStart = Math.max(0, source.duration - duration - 0.15);
      const start = maxStart > 0 ? Math.random() * maxStart : 0;
      const reuseScore = scoreClipReuse(usage, source.id, start, duration);
      const samePenalty = source.id === lastAssetId ? 8 : 0;
      candidates.push({ source, start, duration, score: reuseScore + samePenalty });
    }
    const best = candidates.sort((a, b) => a.score - b.score)[0];
    if (!best) break;
    clips.push({
      assetId: best.source.id,
      file: best.source.file,
      fileName: best.source.fileName || path.basename(best.source.file),
      start: best.start,
      duration: best.duration
    });
    lastAssetId = best.source.id;
    remaining -= duration;
  }
  return clips;
}

function renderClips({ clips, videoMeta, usage, runDir, concatVideo, width, height, fps, quality, dedup, overlayFiles, warnings = [] }) {
  const preset = quality === "quality" ? "medium" : "veryfast";
  const crf = quality === "quality" ? "20" : "24";
  const listPath = path.join(runDir, "concat.txt");
  const planPath = path.join(runDir, "clip-plan.json");
  const clipPaths = [];
  const overlayIndexes = pickOverlayIndexes(clips.length, dedup.overlayCount, overlayFiles.length);
  const failedAssetIds = new Set();

  writeClipPlan(planPath, clips);
  for (let index = 0; index < clips.length; index += 1) {
    const clipPath = path.join(runDir, `clip-${String(index).padStart(4, "0")}.mp4`);
    let lastError = null;
    let rendered = false;

    for (let attempt = 0; attempt < 4 && !rendered; attempt += 1) {
      const clip = clips[index];
      try {
        try { fs.rmSync(clipPath, { force: true }); } catch { /* best effort */ }
        renderSingleClip({ clip, clipPath, index, overlayIndexes, overlayFiles, width, height, fps, preset, crf, dedup });
        rendered = true;
      } catch (error) {
        lastError = error;
        failedAssetIds.add(String(clip.assetId || clip.file));
        if (attempt >= 3) break;
        const replacement = pickReplacementClip({
          videoMeta,
          duration: clip.duration,
          usage,
          excludedIds: failedAssetIds
        });
        if (!replacement) break;
        const warning = `素材片段读取失败，已自动替换：${path.basename(clip.file)} -> ${path.basename(replacement.file)}`;
        warnings.push(warning);
        clips[index] = replacement;
        writeClipPlan(planPath, clips, { index, attempt: attempt + 1, warning, error: error.message });
      }
    }

    if (!rendered) {
      const clip = clips[index];
      throw new Error(`无法渲染素材片段 ${index + 1}/${clips.length}：${path.basename(clip.file)}，起点 ${round2(clip.start)} 秒。${lastError?.message || "FFmpeg 未返回详细错误"}`);
    }
    clipPaths.push(clipPath);
  }

  fs.writeFileSync(listPath, clipPaths.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  run("ffmpeg", ["-y", "-hide_banner", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", concatVideo]);
}

function renderSingleClip({ clip, clipPath, index, overlayIndexes, overlayFiles, width, height, fps, preset, crf, dedup }) {
  const speed = dedup.enabled ? randomBetween(dedup.speedMin, dedup.speedMax) : 1;
  const inputDuration = Math.max(0.1, clip.duration * speed);
  const filter = buildClipFilter({ width, height, fps, dedup, speed });
  const overlayPath = overlayIndexes.has(index) ? overlayFiles[Math.floor(Math.random() * overlayFiles.length)] : "";
  if (overlayPath) {
    const args = [
      "-y", "-hide_banner",
      "-ss", String(Math.max(0, clip.start)),
      "-t", String(inputDuration),
      "-i", clip.file
    ];
    const overlayExt = path.extname(overlayPath).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".webp"].includes(overlayExt)) args.push("-loop", "1", "-t", String(clip.duration), "-i", overlayPath);
    else args.push("-stream_loop", "-1", "-t", String(clip.duration), "-i", overlayPath);
    args.push(
      "-filter_complex",
      `[0:v]${filter}[base];[1:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=rgba,colorchannelmixer=aa=${dedup.overlayOpacity.toFixed(3)}[ol];[base][ol]overlay=0:0:shortest=1,format=yuv420p[out]`,
      "-map", "[out]", "-an", "-c:v", "libx264", "-preset", preset, "-crf", crf, clipPath
    );
    run("ffmpeg", args);
    return;
  }
  run("ffmpeg", [
    "-y", "-hide_banner",
    "-ss", String(Math.max(0, clip.start)),
    "-t", String(inputDuration),
    "-i", clip.file,
    "-vf", filter,
    "-an", "-c:v", "libx264", "-preset", preset, "-crf", crf, clipPath
  ]);
}

function pickReplacementClip({ videoMeta, duration, usage, excludedIds }) {
  const candidates = [];
  for (let index = 0; index < 80; index += 1) {
    const source = videoMeta[Math.floor(Math.random() * videoMeta.length)];
    if (!source || excludedIds.has(String(source.id || source.file)) || source.duration < duration + 0.15) continue;
    const maxStart = Math.max(0, source.duration - duration - 0.15);
    const start = maxStart > 0 ? Math.random() * maxStart : 0;
    candidates.push({
      assetId: source.id,
      file: source.file,
      fileName: source.fileName || path.basename(source.file),
      start,
      duration,
      score: scoreClipReuse(usage, source.id, start, duration)
    });
  }
  const best = candidates.sort((a, b) => a.score - b.score)[0];
  if (!best) return null;
  delete best.score;
  return best;
}

function writeClipPlan(planPath, clips, diagnostic = null) {
  fs.writeFileSync(planPath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    diagnostic,
    clips: clips.map((clip, index) => ({
      index,
      assetId: clip.assetId,
      file: clip.file,
      start: round2(clip.start),
      duration: round2(clip.duration)
    }))
  }, null, 2), "utf8");
}
function prepareAudioWithBackgroundMusic({ audioPath, backgroundMusicFiles, runDir, duration, volume }) {
  if (!Array.isArray(backgroundMusicFiles) || !backgroundMusicFiles.length) return audioPath;
  const bgmPath = backgroundMusicFiles[Math.floor(Math.random() * backgroundMusicFiles.length)];
  const outputPath = path.join(runDir, "mixed-audio.m4a");
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-i", audioPath,
    "-stream_loop", "-1",
    "-i", bgmPath,
    "-t", String(duration),
    "-filter_complex", `[1:a]volume=${volume.toFixed(3)}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[a]`,
    "-map", "[a]",
    "-c:a", "aac",
    "-b:a", "192k",
    outputPath
  ]);
  return outputPath;
}

function copyToSaveDir(outputPath, saveDir) {
  if (!saveDir) return "";
  ensureDir(saveDir);
  const target = path.join(saveDir, path.basename(outputPath));
  fs.copyFileSync(outputPath, target);
  return target;
}

function buildClipFilter({ width, height, fps, dedup, speed = 1 }) {
  const filters = [];
  if (dedup?.enabled) {
    const scaleFactor = randomBetween(dedup.scaleMin, dedup.scaleMax);
    const rotateDeg = randomBetween(dedup.rotateMin, dedup.rotateMax);
    const brightness = randomBetween(dedup.brightnessMin, dedup.brightnessMax);
    const contrast = randomBetween(dedup.contrastMin, dedup.contrastMax);
    const saturation = randomBetween(dedup.saturationMin, dedup.saturationMax);
    const mirror = Math.random() * 100 < dedup.mirrorChance;
    const scaledWidth = Math.ceil(width * scaleFactor / 2) * 2;
    const scaledHeight = Math.ceil(height * scaleFactor / 2) * 2;
    filters.push(`scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase`);
    if (mirror) filters.push("hflip");
    if (Math.abs(rotateDeg) > 0.01) {
      filters.push(`rotate=${(rotateDeg * Math.PI / 180).toFixed(6)}:ow=rotw(iw):oh=roth(ih):fillcolor=black`);
      filters.push(`scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase`);
    }
    filters.push(`crop=${width}:${height}`);
    filters.push(`eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}`);
    if (dedup.sharpen > 0) {
      const amount = dedup.sharpen.toFixed(2);
      filters.push(`unsharp=5:5:${amount}:3:3:0.00`);
    }
  } else {
    filters.push(`scale=${width}:${height}:force_original_aspect_ratio=increase`);
    filters.push(`crop=${width}:${height}`);
  }
  if (Math.abs(speed - 1) > 0.001) filters.push(`setpts=PTS/${speed.toFixed(4)}`);
  filters.push("setsar=1", `fps=${fps}`, "format=yuv420p");
  return filters.join(",");
}

function pickOverlayIndexes(clipCount, requestedCount, overlayFileCount) {
  const max = Math.min(Math.max(0, Math.round(Number(requestedCount) || 0)), clipCount);
  if (!max || !overlayFileCount) return new Set();
  const indexes = Array.from({ length: clipCount }, (_, index) => index);
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return new Set(indexes.slice(0, max));
}

function normalizeDedupSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const enabled = source.enabled !== false;
  const scaleMin = clampNumber(source.scaleMin, 1, 1.3, 1.03);
  const scaleMax = clampNumber(source.scaleMax, 1, 1.3, 1.08);
  const rotateMin = clampNumber(source.rotateMin, -5, 0, -0.8);
  const rotateMax = clampNumber(source.rotateMax, 0, 5, 0.8);
  const brightnessMin = clampNumber(source.brightnessMin, -0.2, 0.2, -0.03);
  const brightnessMax = clampNumber(source.brightnessMax, -0.2, 0.2, 0.04);
  const contrastMin = clampNumber(source.contrastMin, 0.7, 1.5, 0.96);
  const contrastMax = clampNumber(source.contrastMax, 0.7, 1.5, 1.06);
  const saturationMin = clampNumber(source.saturationMin, 0.5, 1.8, 0.95);
  const saturationMax = clampNumber(source.saturationMax, 0.5, 1.8, 1.12);
  const speedMin = clampNumber(source.speedMin, 0.85, 1.15, 0.96);
  const speedMax = clampNumber(source.speedMax, 0.85, 1.15, 1.04);
  return {
    enabled,
    scaleMin: Math.min(scaleMin, scaleMax),
    scaleMax: Math.max(scaleMin, scaleMax),
    rotateMin: Math.min(rotateMin, rotateMax),
    rotateMax: Math.max(rotateMin, rotateMax),
    brightnessMin: Math.min(brightnessMin, brightnessMax),
    brightnessMax: Math.max(brightnessMin, brightnessMax),
    contrastMin: Math.min(contrastMin, contrastMax),
    contrastMax: Math.max(contrastMin, contrastMax),
    saturationMin: Math.min(saturationMin, saturationMax),
    saturationMax: Math.max(saturationMin, saturationMax),
    mirrorChance: clampNumber(source.mirrorChance, 0, 100, 30),
    sharpen: clampNumber(source.sharpen, 0, 1, 0.2),
    speedMin: Math.min(speedMin, speedMax),
    speedMax: Math.max(speedMin, speedMax),
    overlayDir: String(source.overlayDir || "").trim(),
    overlayOpacity: clampNumber(source.overlayOpacity, 0, 1, 0.01),
    overlayCount: clampInt(source.overlayCount, 0, 50, 0)
  };
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function muxAudioAndCaptions({ inputVideo, audioPath, outputPath, captions, width, height, fontFile, subtitleFontSize, subtitleYPercent, subtitleAnimationMode, duration }) {
  const args = ["-y", "-hide_banner", "-i", inputVideo, "-i", audioPath, "-t", String(duration)];
  if (Array.isArray(captions?.cues) && captions.cues.length) {
    const assPath = path.join(path.dirname(inputVideo), "captions.ass");
    const ass = subtitleAnimationMode === "word-highlight" && Array.isArray(captions?.words) && captions.words.length
      ? makeWordHighlightSubtitles(captions.cues, captions.words, { width, height, fontFile, fontSize: subtitleFontSize, yPercent: subtitleYPercent })
      : makeAssSubtitles(captions.cues, { width, height, fontFile, fontSize: subtitleFontSize, yPercent: subtitleYPercent });
    fs.writeFileSync(assPath, ass, "utf8");
    args.push("-vf", `subtitles='${ffPath(assPath).replace(/'/g, "\\'")}'`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22");
  } else {
    args.push("-c:v", "copy");
  }
  args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath);
  run("ffmpeg", args);
}

async function getCachedOrTranscribeCaptions({ audioPath, apiKey, modelId, requireWords = false }) {
  const audioBuffer = fs.readFileSync(audioPath);
  const cacheKey = crypto.createHash("sha256").update("reddit-mix-caption-cache-v1").update("\0").update(String(modelId || "scribe_v2")).update("\0").update(audioBuffer).digest("hex");
  const cachePath = path.join(captionCacheDir, `${cacheKey}.json`);
  const cached = readCaptionCache(cachePath);
  if (cached && (!requireWords || Array.isArray(cached.words) && cached.words.length)) return { captions: cached, cacheHit: true };
  const captions = await transcribeCaptionsWithElevenLabs({ audioPath, apiKey, modelId, audioBuffer });
  fs.writeFileSync(cachePath, JSON.stringify({ ...captions, cachedAt: new Date().toISOString() }, null, 2), "utf8");
  return { captions, cacheHit: false };
}

async function transcribeCaptionsWithElevenLabs({ audioPath, apiKey, modelId, audioBuffer }) {
  if (!apiKey) throw new Error("ElevenLabs API Key 未配置，无法识别字幕。");
  const form = new FormData();
  form.append("model_id", modelId || "scribe_v2");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");
  form.append("file", new Blob([audioBuffer]), path.basename(audioPath));
  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": apiKey }, body: form });
  const raw = await response.text();
  if (!response.ok) throw new Error(`ElevenLabs 字幕识别失败：${raw.slice(0, 800) || response.status}`);
  const data = JSON.parse(raw);
  const cues = makeCaptionCues(data.words, data.text);
  if (!cues.length) {
    const error = new Error(`ElevenLabs 没有返回可用字幕时间戳：${path.basename(audioPath)}`);
    error.code = "EMPTY_TRANSCRIPT";
    throw error;
  }
  return { provider: "elevenlabs", model: modelId || "scribe_v2", text: data.text || "", cues, words: makeWordCues(data.words) };
}

function makeWordCues(words = []) {
  return Array.isArray(words)
    ? words.map((item) => ({
      text: cleanCaptionToken(item.text || item.word || ""),
      start: Number(item.start ?? item.start_time),
      end: Number(item.end ?? item.end_time)
    })).filter((item) => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= item.start)
    : [];
}

function makeCaptionCues(words = [], fallbackText = "") {
  const normalized = Array.isArray(words)
    ? words.map((item) => ({ text: cleanCaptionToken(item.text || item.word || ""), start: Number(item.start ?? item.start_time), end: Number(item.end ?? item.end_time) }))
      .filter((item) => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= item.start)
    : [];
  if (!normalized.length) return String(fallbackText || "").trim() ? [{ start: 0, end: 3, text: String(fallbackText).trim() }] : [];

  const cues = [];
  let current = null;
  for (const word of normalized) {
    const token = cleanCaptionToken(word.text);
    if (!token) continue;
    if (!current) {
      current = { start: word.start, end: word.end, text: token };
      continue;
    }
    const nextText = joinCaptionText(current.text, token);
    const shouldBreak = Math.max(0, word.start - current.end) > 0.42 || word.end - current.start > 2.35 || visibleLength(nextText) > 30 || /[.!?。！？]$/.test(current.text);
    if (shouldBreak) {
      cues.push(fitCaptionCue(current));
      current = { start: word.start, end: word.end, text: token };
    } else {
      current.text = nextText;
      current.end = word.end;
    }
  }
  if (current) cues.push(fitCaptionCue(current));
  return cues.filter((cue) => cue.text && cue.end > cue.start);
}

function makeAssSubtitles(cues, { width, height, fontFile, fontSize, yPercent }) {
  const marginV = Math.round(height * (Math.max(0, Math.min(100, yPercent)) / 100));
  const fontName = path.basename(fontFile || "Microsoft YaHei").replace(/\.[^.]+$/, "");
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H8A000000,-1,0,0,0,100,100,0,0,1,5,2,2,72,72,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];
  for (const cue of cues) lines.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${escapeAss(cue.text)}`);
  return lines.join("\n");
}

function makeWordHighlightSubtitles(cues, words, { width, height, fontFile, fontSize, yPercent }) {
  const marginV = Math.round(height * (Math.max(0, Math.min(100, yPercent)) / 100));
  const fontName = path.basename(fontFile || "Microsoft YaHei").replace(/\.[^.]+$/, "");
  const highlightSize = Math.round(fontSize * 1.08);
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H8A000000,-1,0,0,0,100,100,0,0,1,5,2,2,72,72,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];

  for (const cue of cues) {
    const cueWords = words
      .filter((word) => word.end >= cue.start - 0.03 && word.start <= cue.end + 0.03)
      .filter((word) => word.text);
    if (!cueWords.length) {
      lines.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${escapeAss(cue.text)}`);
      continue;
    }
    for (let index = 0; index < cueWords.length; index++) {
      const word = cueWords[index];
      const start = Math.max(cue.start, word.start);
      const end = Math.min(cue.end, cueWords[index + 1]?.start || word.end || cue.end);
      if (end <= start) continue;
      const text = cueWords.map((item, itemIndex) => {
        const escaped = escapeAss(item.text);
        if (itemIndex !== index) return escaped;
        return `{\\c&H00E8FF&\\fs${highlightSize}}${escaped}{\\rDefault}`;
      }).reduce(joinCaptionText, "");
      lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`);
    }
  }
  return lines.join("\n");
}

function readCaptionCache(cachePath) {
  if (!fs.existsSync(cachePath)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return Array.isArray(value?.cues) && value.cues.length ? value : null;
  } catch {
    return null;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) {
    const output = String(result.stderr || result.stdout || result.error?.message || "").trim();
    const tail = output ? output.slice(-2400) : `signal=${result.signal || "none"}; spawnError=${result.error?.message || "none"}`;
    const commandLine = [command, ...args].map((value) => /\s/.test(String(value)) ? JSON.stringify(String(value)) : String(value)).join(" ");
    throw new Error(`${command} failed with exit code ${result.status}: ${tail}\nCommand: ${commandLine}`);
  }
}

function patchJob(patch) {
  const current = fs.existsSync(jobPath) ? JSON.parse(fs.readFileSync(jobPath, "utf8")) : {};
  fs.writeFileSync(jobPath, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}

function uniqueOutputId(baseId) {
  let id = safeFileName(baseId);
  let index = 2;
  while (fs.existsSync(path.join(defaultOutputDir, `${id}.mp4`))) {
    id = safeFileName(`${baseId}-${index}`);
    index += 1;
  }
  return id;
}

function safeFileName(value) {
  return String(value || "reddit-mix").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "reddit-mix";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clampInt(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeSubtitleAnimationMode(value) {
  return value === "word-highlight" ? "word-highlight" : "sentence";
}

function progress(done, total, stagePercent) {
  const base = total > 0 ? (done / total) * 100 : 0;
  const currentUnit = total > 0 ? stagePercent / total : 0;
  return Math.min(99, Math.max(1, Math.round(base + currentUnit)));
}

function cleanCaptionToken(value) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function joinCaptionText(left, right) {
  if (!left) return right;
  if (/[\u4e00-\u9fff]$/.test(left) || /^[\u4e00-\u9fff]/.test(right)) return `${left}${right}`;
  return `${left} ${right}`;
}

function fitCaptionCue(cue) {
  return { start: Math.max(0, Number(cue.start) || 0), end: Math.max((Number(cue.start) || 0) + 0.2, Number(cue.end) || 0), text: String(cue.text || "").trim() };
}

function visibleLength(text) {
  return Array.from(String(text || "")).reduce((sum, char) => sum + (/[\u4e00-\u9fff]/.test(char) ? 2 : 1), 0);
}

function assTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const centis = Math.floor((safe - Math.floor(safe)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

function escapeAss(text) {
  return String(text || "").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
}

function ffPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/:/g, "\\:");
}
