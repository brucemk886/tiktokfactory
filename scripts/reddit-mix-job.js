import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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
import { findAudioInLibrary, listAudioLibraryFiles, normalizeAudioDirs } from "./audio-library-groups.js";
import { resolveStorageDirs } from "./storage-paths.js";
import { planMixAudioOrder } from "./mix-audio-pick.js";
import { reserveAudioRotation } from "./audio-rotation.js";
import { isParkourVideoTemplate, listUnusedParkourSources, planParkourSources } from "./video-template.js";
import { buildEndCardDimFilter, buildNovelBadgeDrawtext, buildNovelEndCardDrawtext, buildOpeningTitleDrawtext, buildTikTokCaption, hideCaptionsAfter, hideCaptionsUntil, renderNovelAppIcon, resolveEndCardStart, resolveNovelEndCard, resolveNovelScriptText, resolveNovelVideoBadge, resolveOpeningHookTitle, resolveOpeningTitleDuration } from "./novel-video-badge.js";
import { checkTtsReadback, recordTtsReadbackFailure } from "./tts-readback.js";
import { makeWordPopSubtitles, normalizeSubtitleAnimationMode, subtitleNeedsWordTimestamps } from "./subtitle-animation.js";

const payloadPath = process.argv[2];
const jobPath = process.argv[3];
const root = process.cwd();
const bootConfig = readJson(path.join(root, "config.json"), {});
const storageDirs = resolveStorageDirs(root, bootConfig);
const defaultOutputDir = storageDirs.outputDir;
const workDir = path.join(storageDirs.workDir, "reddit-mix");
const captionCacheDir = path.join(storageDirs.workDir, "caption-cache");
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".opus", ".webm", ".ogg"];
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
  const legacyVariants = clampInt(payload.variants, 1, 20, 1);
  const audioFiles = resolveMixAudios(payload);
  const total = clampInt(payload.totalVideos, 1, 300, audioFiles.length * legacyVariants);
  const { audios, rotation } = orderMixAudios(payload, audioFiles, total);
  const saveDir = resolveSaveDir(payload.saveDir);
  const backgroundMusicFiles = resolveBackgroundMusicFiles(payload.backgroundMusicDir);
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
  const requirePromotionCode = payload.requirePromotionCode !== false && payload.burnNovelBadge !== false;
  patchJob({
    status: "running",
    message: hasNvencEncoder()
      ? "混剪使用显卡一次合成（NVENC）。去重只保留缩放、镜像和变速。"
      : "混剪使用 CPU 一次合成。去重只保留缩放、镜像和变速。本机未检测到 NVENC。",
    audioRotation: rotation,
    updatedAt: Date.now()
  });

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

  const results = [];
  const audioContexts = new Map();
  const skippedAudios = new Set();
  const usedParkourIds = new Set();
  const warnings = [];
  let done = 0;
  let candidateIndex = 0;
  let failedVideos = 0;
  let attempts = 0;
  const maxAttempts = total + Math.max(20, Math.ceil(total * 0.5));

  while (done < total && attempts < maxAttempts) {
    attempts += 1;
    let runDir = "";
    try {
    const latest = fs.existsSync(jobPath) ? JSON.parse(fs.readFileSync(jobPath, "utf8")) : {};
    if (["canceled", "cancelled"].includes(String(latest.status || "").toLowerCase())) {
      patchJob({
        status: "canceled",
        message: "任务已停止。",
        percent: Number(latest.percent || 0),
        updatedAt: Date.now()
      });
      break;
    }
    const audioIndex = candidateIndex % audios.length;
    const audioPath = audios[audioIndex];
    const variant = Math.floor(candidateIndex / audios.length) + 1;
    candidateIndex += 1;
    if (skippedAudios.has(audioPath)) {
      // Walking past an already-skipped audio is not a render attempt.
      attempts -= 1;
      continue;
    }
    const audioFallback = fallbackForAudio(payload, audioPath);
    if (requirePromotionCode && !audioContexts.has(audioPath)) {
      // A video the viewer cannot act on (no promo code to search) still burns a
      // publish slot on an account. Skip the audio instead of shipping it blind.
      const identity = resolveNovelEndCard({ workDir: storageDirs.workDir, audioPath, fallback: audioFallback });
      if (!identity?.promotionCode) {
        const warning = `没有推广码，已跳过：${path.basename(audioPath)}（在音频文件夹的 novel.json 或小说库里补推广码）`;
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
        if (skippedAudios.size >= audios.length) throw new Error("所有音频都没有推广码，任务无法继续。请先在音频文件夹里补 novel.json（platform + promotionCode）。");
        attempts -= 1;
        continue;
      }
    }
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
            requireWords: subtitleNeedsWordTimestamps(subtitleAnimationMode)
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
        if (payload.ttsReadback !== false) {
          // The transcript we just paid for doubles as a TTS proof-read: if it
          // drifts too far from the script we synthesized, the voice mangled
          // it (names, numbers, the app name) and the video should not ship.
          const readback = checkTtsReadback({
            scriptText: resolveNovelScriptText({ workDir: storageDirs.workDir, audioPath }),
            transcript: captions,
            maxWordErrorRate: payload.ttsReadbackMaxWer ?? config.ttsReadbackMaxWer
          });
          if (readback.checked && !readback.ok) {
            const warning = `配音回读不一致（字错率 ${Math.round(readback.wer * 100)}%，上限 ${Math.round(readback.limit * 100)}%），已跳过：${path.basename(audioPath)}`;
            recordTtsReadbackFailure(storageDirs.workDir, { audioPath, wer: readback.wer, limit: readback.limit, referenceWords: readback.referenceWords, hypothesisWords: readback.hypothesisWords, taskName: payload.name || "" });
            skippedAudios.add(audioPath);
            warnings.push(warning);
            patchJob({ status: "running", message: warning, warnings, progressCurrent: done, progressTotal: total, updatedAt: Date.now() });
            if (skippedAudios.size >= audios.length) throw new Error("所有音频的配音回读都不一致，任务无法继续。去 work/tts-readback.json 看是哪些音频，重新配音或修文案。");
            attempts -= 1;
            continue;
          }
        }
      }
      audioContext = { audioDuration, captions };
      audioContexts.set(audioPath, audioContext);
    }
    const { audioDuration, captions } = audioContext;

    const baseId = safeFileName(`${path.basename(audioPath, path.extname(audioPath)).slice(0, 24)}-reddit-${variant}`);
    const id = uniqueOutputId(baseId);
    runDir = path.join(workDir, `${id}-${Date.now()}`);
    ensureDir(runDir);

    patchJob({
      status: "running",
      percent: progress(done, total, 12),
      message: isParkourVideoTemplate(payload)
        ? `套用跑酷成片：${group.name || group.id}，${path.basename(audioPath)} 第 ${variant} 轮`
        : `抽取素材组：${group.name || group.id}，${path.basename(audioPath)} 第 ${variant} 轮`,
      progressCurrent: Math.min(total, done + 1),
      progressTotal: total,
      updatedAt: Date.now()
    });

    const usage = readUsage(root);
    const outputPath = path.join(defaultOutputDir, `${id}.mp4`);
    const quality = payload.quality || "fast";
    const fontFile = resolveBadgeFont(config.fontFile);
    let clips;
    let concatVideo = "";
    if (isParkourVideoTemplate(payload)) {
      const bed = renderParkourBed({
        videoMeta,
        audioDuration,
        usage,
        usedIds: usedParkourIds,
        runDir,
        width,
        height,
        fps,
        quality
      });
      clips = bed.clips;
      concatVideo = bed.concatVideo;
      for (const clip of clips) {
        if (clip?.assetId) usedParkourIds.add(clip.assetId);
        if (clip?.file) usedParkourIds.add(clip.file);
      }
      patchJob({
        message: `跑酷底片：${bed.plan.mode === "single" ? "单条成片" : `${bed.plan.sources} 条拼接`}，裁掉 ${bed.plan.waste}s，${path.basename(audioPath)}`,
        updatedAt: Date.now()
      });
    } else {
      const segmentSeconds = resolveSegmentSeconds(payload, audioDuration);
      clips = pickClips({ videoMeta, audioDuration, segmentSeconds, usage });
      concatVideo = path.join(runDir, "mixed-video.mp4");
    }

    const finalAudioPath = prepareAudioWithBackgroundMusic({
      audioPath,
      backgroundMusicFiles,
      runDir,
      duration: audioDuration,
      volume: clampNumber(payload.backgroundMusicVolume, 0, 1, 0.12)
    });

    const novelBadge = payload.burnNovelBadge === false
      ? null
      : resolveNovelVideoBadge({
        workDir: storageDirs.workDir,
        audioPath,
        fallback: audioFallback
      });
    if (payload.burnNovelBadge !== false && !novelBadge) {
      warnings.push(`未找到小说平台/推广码，已跳过角标：${path.basename(audioPath)}`);
    }

    const captionTitle = resolveOpeningHookTitle({
      workDir: storageDirs.workDir,
      audioPath,
      fallbackTitle: audioFallback.openingTitle || payload.openingTitle || ""
    });
    const openingTitle = payload.openingTitleEnabled ? captionTitle : "";
    if (payload.openingTitleEnabled && !openingTitle) {
      warnings.push(`未找到开头标题，已跳过前3秒标题：${path.basename(audioPath)}`);
    }
    const endCard = payload.endCardEnabled === false
      ? null
      : resolveNovelEndCard({
        workDir: storageDirs.workDir,
        audioPath,
        fallback: audioFallback
      });
    if (payload.endCardEnabled !== false && !endCard) {
      warnings.push(`未找到推广码/平台，已跳过片尾搜书引导：${path.basename(audioPath)}`);
    }
    const tiktokCaption = buildTikTokCaption({
      promotionCopy: novelBadge?.promotionCopy || audioFallback.promotionCopy || "",
      platform: novelBadge?.platform || audioFallback.platform || "",
      hookLine: captionTitle,
      audioTitle: path.basename(audioPath),
      seed: id
    });

    const muxOptions = {
      audioPath: finalAudioPath,
      outputPath,
      captions,
      width,
      height,
      fontFile,
      subtitleFontSize,
      subtitleYPercent,
      subtitleAnimationMode,
      duration: audioDuration,
      novelBadge,
      openingTitle,
      endCard,
      quality
    };

    let encodeSeconds = 0;
    let encodeMode = isParkourVideoTemplate(payload) ? "parkour" : "one-pass";
    const encodeStarted = Date.now();
    if (isParkourVideoTemplate(payload)) {
      patchJob({
        status: "running",
        percent: progress(done, total, 62),
        message: `合成音频和字幕：${path.basename(audioPath)} 第 ${variant} 轮`,
        progressCurrent: Math.min(total, done + 1),
        progressTotal: total,
        updatedAt: Date.now()
      });
      muxAudioAndCaptions({ inputVideo: concatVideo, ...muxOptions });
    } else {
      patchJob({
        status: "running",
        percent: progress(done, total, 28),
        message: `一次合成：${path.basename(audioPath)} 第 ${variant} 轮`,
        progressCurrent: Math.min(total, done + 1),
        progressTotal: total,
        updatedAt: Date.now()
      });
      renderMixOnePass({
        clips,
        runDir,
        width,
        height,
        fps,
        quality,
        dedup,
        overlayFiles,
        ...muxOptions
      });
    }
    encodeSeconds = round2((Date.now() - encodeStarted) / 1000);

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
      novelId: novelBadge?.novelId || audioFallback.novelId || "",
      audioLibraryId: audioFallback.audioLibraryId || "",
      scriptId: audioFallback.scriptId || "",
      novelPlatform: novelBadge?.platform || audioFallback.platform || "",
      novelPromotionCode: novelBadge?.promotionCode || audioFallback.promotionCode || "",
      openingTitle: captionTitle,
      promotionCopy: novelBadge?.promotionCopy || audioFallback.promotionCopy || "",
      videoDesc: tiktokCaption,
      assetGroupId: group.id,
      assetGroupName: group.name || group.id,
      duration: audioDuration,
      encodeSeconds,
      encodeMode,
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
      message: `已完成 ${done}/${total}，本条合成 ${encodeSeconds} 秒`,
      progressCurrent: done,
      progressTotal: total,
      results,
      warnings,
      updatedAt: Date.now()
    });
    cleanupRunDir(runDir);
    } catch (error) {
      failedVideos += 1;
      const reason = String(error?.message || error || "未知错误").replace(/\s+/g, " ").slice(0, 1200);
      const warning = `第 ${attempts} 条合成失败，已跳过：${reason}`;
      warnings.push(warning);
      patchJob({
        status: "running",
        percent: progress(done, total, 0),
        message: `${warning} 继续下一条。`,
        progressCurrent: done,
        progressTotal: total,
        failedVideoCount: failedVideos,
        attempts,
        results,
        warnings,
        updatedAt: Date.now()
      });
      if (runDir) cleanupRunDir(runDir);
      // No unused parkour footage left: every further audio would fail the same way.
      if (error?.code === PARKOUR_EXHAUSTED) break;
    }
  }

  if (!results.length && failedVideos > 0) {
    throw new Error(`全部合成失败，已跳过 ${failedVideos} 条。${warnings.at(-1) || ""}`);
  }
  if (done < total) {
    warnings.push(`任务结束：完成 ${done}/${total}，跳过 ${failedVideos} 条。`);
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

function normalizeAudioItems(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      id: String(item?.id || "").trim(),
      scriptId: String(item?.scriptId || "").trim(),
      path: String(item?.path || item?.file || "").trim(),
      fileName: String(item?.fileName || "").trim(),
      novelId: String(item?.novelId || "").trim(),
      platform: String(item?.platform || item?.novelPlatform || "").trim(),
      promotionCode: String(item?.promotionCode || item?.novelPromotionCode || "").trim(),
      promotionCopy: String(item?.promotionCopy || "").trim(),
      openingTitle: String(item?.openingTitle || item?.title || "").trim(),
      title: String(item?.title || "").trim(),
      bookId: String(item?.bookId || item?.novelBookId || "").trim(),
      novelTitle: String(item?.novelTitle || "").trim()
    }))
    .filter((item) => item.id || item.path);
}

function readAudioLibraryIndex(workDir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(workDir, "audio-library", "index.json"), "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function resolveMixAudios(payload) {
  const items = normalizeAudioItems(payload.audioItems);
  const index = readAudioLibraryIndex(storageDirs.workDir);
  const filesDir = path.join(storageDirs.workDir, "audio-library", "files");
  const fromItems = [];
  const missing = [];
  const libraryFiles = items.length ? listAudioLibraryFiles(bootConfig) : [];
  for (const item of items) {
    const record = index.find((entry) => String(entry?.id || "") === item.id);
    const found = [
      item.path,
      record?.fileName ? path.join(filesDir, record.fileName) : "",
      record?.targetAudioPath,
      item.fileName ? path.join(filesDir, item.fileName) : "",
      findAudioInLibrary([item.path, item.fileName, record?.fileName, item.id], bootConfig, libraryFiles)
    ].find((file) => file && fs.existsSync(file));
    if (found) fromItems.push(found);
    else missing.push(item.title || item.fileName || item.id);
  }
  if (items.length && missing.length) {
    throw new Error(`本机音频目录里找不到这些小说音频：${missing.join("、")}。把 mp3 放到 F:\\音频目录，或在这台工人机上生成音频。`);
  }
  let fromDir = [];
  if (!fromItems.length) {
    for (const dir of normalizeAudioDirs(payload.audioDirs, payload.audioDir)) {
      fromDir.push(...listMediaFiles(mustBeDirectory(dir, "音频文件夹"), AUDIO_EXTENSIONS));
    }
  }
  const merged = [];
  const seen = new Set();
  for (const file of [...fromItems, ...fromDir]) {
    const key = path.resolve(file);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(file);
  }
  if (!merged.length) throw new Error("没有找到可用音频。请勾选小说平台。");
  return resolvePrioritizedAudios(merged, payload.audioPriority);
}

// Folder-based selections walk the folder with a persistent cursor so the
// next task continues where this one stops. Explicit lists (audioItems from the
// operation brain, audioPriority, or a hand-set audioOffset) keep their order.
function orderMixAudios(payload, files, total) {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  const manualOffset = Math.max(0, Number(payload.audioOffset) || 0);
  const hasItems = normalizeAudioItems(payload.audioItems).length > 0;
  const hasPriority = Array.isArray(payload.audioPriority) && payload.audioPriority.some((name) => String(name || "").trim());
  if (!list.length) return { audios: list, rotation: null };
  if (hasItems || hasPriority) {
    return { audios: rotateList(planMixAudioOrder(list), manualOffset), rotation: null };
  }
  const dirs = normalizeAudioDirs(payload.audioDirs, payload.audioDir);
  if (manualOffset > 0 || payload.audioRotation === false) {
    return { audios: rotateList(list, manualOffset), rotation: null };
  }
  const reservation = reserveAudioRotation({ workDir: storageDirs.workDir, dirs, audioCount: list.length, count: total });
  return {
    audios: rotateList(list, reservation.offset),
    rotation: reservation.reserved
      ? { key: reservation.key, offset: reservation.offset, audioCount: list.length, count: total }
      : null
  };
}

function rotateList(list, offset) {
  if (!list.length) return list;
  const shift = ((Math.floor(Number(offset) || 0) % list.length) + list.length) % list.length;
  return shift ? [...list.slice(shift), ...list.slice(0, shift)] : list;
}

function fallbackForAudio(payload, audioPath) {
  const items = normalizeAudioItems(payload.audioItems);
  const resolved = path.resolve(String(audioPath || ""));
  const baseName = path.basename(resolved);
  const hit = items.find((item) => item.path && path.resolve(item.path) === resolved)
    || items.find((item) => item.id && (baseName.includes(item.id) || resolved.includes(item.id)));
  // The task payload only carries the novel fields of the first ticked folder.
  // With several folders ticked, applying them to every audio would stamp
  // folder A's promo code on folder B's story, so only trust them for a
  // single-folder task; multi-folder audio must resolve from its own
  // novel.json / novel store.
  const multiFolder = !hit && normalizeAudioDirs(payload.audioDirs, payload.audioDir).length > 1;
  const payloadNovel = multiFolder ? {} : payload;
  return {
    audioLibraryId: hit?.id || "",
    scriptId: hit?.scriptId || "",
    novelId: hit?.novelId || payloadNovel.novelId,
    platform: hit?.platform || payloadNovel.novelPlatform,
    promotionCode: hit?.promotionCode || payloadNovel.novelPromotionCode,
    promotionCopy: hit?.promotionCopy || payloadNovel.promotionCopy || "",
    openingTitle: hit?.openingTitle || hit?.title || payloadNovel.openingTitle || "",
    bookId: hit?.bookId || payloadNovel.novelBookId || payloadNovel.bookId || "",
    novelTitle: hit?.novelTitle || payloadNovel.novelTitle || ""
  };
}

function resolvePrioritizedAudios(files, priorityNames) {
  const priorities = Array.isArray(priorityNames)
    ? priorityNames.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  if (!priorities.length) return files;
  const fileByName = new Map();
  for (const file of files || []) {
    const key = path.basename(file).toLowerCase();
    if (!fileByName.has(key)) fileByName.set(key, file);
  }
  const selected = priorities
    .map((name) => fileByName.get(name.toLowerCase()))
    .filter(Boolean);
  return selected.length ? selected : files;
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

const PARKOUR_EXHAUSTED = "PARKOUR_EXHAUSTED";

// Template 2: whole parkour renders as the bed, each used once. A single
// video long enough for the audio is preferred; otherwise unused shorter
// videos are stitched in sequence. Whatever exceeds the audio is cut off.
function renderParkourBed({ videoMeta, audioDuration, usage, usedIds, runDir, width, height, fps, quality }) {
  // The group index keeps files that were since moved to _failed-review etc.
  const present = (Array.isArray(videoMeta) ? videoMeta : []).filter((source) => source?.file && fs.existsSync(source.file));
  const plan = planParkourSources(present, audioDuration, { usedIds, usage });
  if (!plan) {
    const left = listUnusedParkourSources(present, { usedIds, usage });
    const error = new Error(left.length
      ? `剩下 ${left.length} 条未用的跑酷视频加起来也不够 ${Math.round(audioDuration)} 秒，这条音频先跳过。`
      : "跑酷视频都已抽过，没有未使用的成片了。");
    if (!left.length) error.code = PARKOUR_EXHAUSTED;
    throw error;
  }
  const concatVideo = path.join(runDir, "parkour-bed.mp4");
  const normalize = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps},format=yuv420p`;
  const args = ["-y", "-hide_banner"];
  if (plan.mode === "single") {
    args.push("-i", plan.sources[0].file, "-t", String(audioDuration), "-vf", normalize, "-an", ...clipVideoEncodeArgs(quality), concatVideo);
  } else {
    for (const source of plan.sources) args.push("-i", source.file);
    const chains = plan.sources.map((_, index) => `[${index}:v]${normalize},setpts=PTS-STARTPTS[v${index}]`);
    const concat = `${plan.sources.map((_, index) => `[v${index}]`).join("")}concat=n=${plan.sources.length}:v=1:a=0[bed]`;
    args.push("-filter_complex", `${chains.join(";")};${concat}`, "-map", "[bed]", "-t", String(audioDuration), "-an", ...clipVideoEncodeArgs(quality), concatVideo);
  }
  run("ffmpeg", args);
  let offset = 0;
  const clips = plan.sources.map((source) => {
    const duration = Math.max(0, Math.min(source.duration, audioDuration - offset));
    offset += duration;
    return {
      assetId: source.id,
      file: source.file,
      fileName: source.fileName || path.basename(source.file),
      start: 0,
      duration: round2(duration)
    };
  });
  return { concatVideo, clips, plan: { mode: plan.mode, waste: plan.waste, sources: plan.sources.length } };
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

function renderMixOnePass({
  clips,
  runDir,
  width,
  height,
  fps,
  quality,
  dedup,
  overlayFiles,
  audioPath,
  outputPath,
  captions,
  fontFile,
  subtitleFontSize,
  subtitleYPercent,
  subtitleAnimationMode,
  duration,
  novelBadge,
  openingTitle,
  endCard
}) {
  if (!Array.isArray(clips) || !clips.length) throw new Error("没有可合成的素材片段。");
  const overlayIndexes = pickOverlayIndexes(clips.length, dedup.overlayCount, overlayFiles.length);
  const linkFiles = clips.map((clip) => clip.file);
  const overlayByClip = new Map();
  for (const index of overlayIndexes) {
    const overlayPath = overlayFiles[Math.floor(Math.random() * overlayFiles.length)];
    if (overlayPath) {
      overlayByClip.set(index, overlayPath);
      linkFiles.push(overlayPath);
    }
  }
  const runKey = `${path.basename(runDir).slice(0, 40)}-${Date.now()}`;
  const shortInputs = createShortMixInputs(linkFiles, runKey);
  try {
    const clipInputs = shortInputs.mapped.slice(0, clips.length);
    const overlayInputs = shortInputs.mapped.slice(clips.length);
    let overlayCursor = 0;
    const chains = [];
    const concatLabels = [];
    clips.forEach((clip, index) => {
      const speed = dedup.enabled ? randomBetween(dedup.speedMin, dedup.speedMax) : 1;
      clip.inputDuration = Math.max(0.1, clip.duration * speed);
      clip.filter = buildClipFilter({ width, height, fps, dedup, speed });
      const overlayPath = overlayByClip.get(index) ? overlayInputs[overlayCursor++] : "";
      const videoLabel = `[${index}:v]${clip.filter}`;
      if (overlayPath) {
        const overlayIndex = clips.length + overlayInputs.indexOf(overlayPath);
        chains.push(`${videoLabel}[b${index}]`);
        chains.push(`[${overlayIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=rgba,colorchannelmixer=aa=${dedup.overlayOpacity.toFixed(3)}[ol${index}]`);
        chains.push(`[b${index}][ol${index}]overlay=0:0:shortest=1,format=yuv420p[v${index}]`);
      } else {
        chains.push(`${videoLabel}[v${index}]`);
      }
      concatLabels.push(`[v${index}]`);
    });
    if (clips.length > 1) {
      chains.push(`${concatLabels.join("")}concat=n=${clips.length}:v=1:a=0[vcat]`);
    }
    const finish = buildFinishVideoFilters({
      workFolder: runDir,
      captions,
      width,
      height,
      fontFile,
      subtitleFontSize,
      subtitleYPercent,
      subtitleAnimationMode,
      duration,
      novelBadge,
      openingTitle,
      endCard
    });
    const audioIndex = clips.length + overlayInputs.length;
    const iconIndex = finish.iconPath ? audioIndex + 1 : -1;
    const sourceLabel = clips.length === 1 ? "v0" : "vcat";
    if (iconIndex >= 0) {
      const pre = finish.filters.length ? finish.filters.join(",") : "format=yuv420p";
      const iconY = Math.round((Number(height) || 1920) * 0.22);
      chains.push(`[${sourceLabel}]${pre}[dec];[${iconIndex}:v]scale=220:220,format=rgba[icon];[dec][icon]overlay=x=(W-w)/2:y=${iconY}:enable='gte(t,${finish.endStart.toFixed(2)})'[vout]`);
    } else if (finish.filters.length) {
      chains.push(`[${sourceLabel}]${finish.filters.join(",")}[vout]`);
    } else {
      chains.push(`[${sourceLabel}]format=yuv420p[vout]`);
    }
    const scriptPath = path.join(runDir, "one-pass.txt");
    fs.writeFileSync(scriptPath, `${chains.join(";\n")}\n`, "utf8");
    writeClipPlan(path.join(runDir, "clip-plan.json"), clips);
    const args = ["-y", "-hide_banner"];
    clips.forEach((clip, index) => {
      args.push("-ss", String(Math.max(0, clip.start)), "-t", String(clip.inputDuration), "-i", clipInputs[index]);
    });
    overlayInputs.forEach((overlayPath, index) => {
      const clipIndex = [...overlayByClip.keys()][index];
      const clipDuration = Math.max(0.1, Number(clips[clipIndex]?.duration) || 5);
      const overlayExt = path.extname(overlayPath).toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".webp"].includes(overlayExt)) args.push("-loop", "1", "-t", String(clipDuration), "-i", overlayPath);
      else args.push("-stream_loop", "-1", "-t", String(clipDuration), "-i", overlayPath);
    });
    args.push("-i", audioPath);
    if (finish.iconPath) args.push("-i", finish.iconPath);
    args.push(
      "-t", String(duration),
      "-/filter_complex", scriptPath,
      "-map", "[vout]",
      "-map", `${audioIndex}:a:0`,
      ...finalVideoEncodeArgs(quality),
      "-shortest",
      "-c:a", "aac",
      "-b:a", resolveFinalEncode(quality).audio,
      "-movflags", "+faststart",
      outputPath
    );
    const commandLength = ["ffmpeg", ...args].reduce((sum, value) => sum + String(value).length + 3, 0);
    if (commandLength > 28000) throw new Error("一次合成命令过长。");
    run("ffmpeg", args);
  } finally {
    for (const dir of shortInputs.dirs || []) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

function createShortMixInputs(files, runKey) {
  const groups = new Map();
  const dirs = [];
  const mapped = [];
  for (const file of files) {
    const resolved = path.resolve(file);
    const root = path.parse(resolved).root;
    if (!groups.has(root)) {
      const dir = path.join(root, "localfactory-mix-in", safeFileName(runKey));
      ensureDir(dir);
      groups.set(root, { dir, index: 0 });
      dirs.push(dir);
    }
    const group = groups.get(root);
    const dest = path.join(group.dir, `${String(group.index).padStart(4, "0")}${path.extname(resolved) || ".mp4"}`);
    group.index += 1;
    try {
      fs.rmSync(dest, { force: true });
      fs.linkSync(resolved, dest);
      mapped.push(dest);
    } catch {
      mapped.push(resolved);
    }
  }
  return { mapped, dirs };
}

function buildFinishVideoFilters({
  workFolder,
  captions,
  width,
  height,
  fontFile,
  subtitleFontSize,
  subtitleYPercent,
  subtitleAnimationMode,
  duration,
  novelBadge,
  openingTitle = "",
  endCard = null
}) {
  const endStart = endCard ? resolveEndCardStart(duration, captions, 3) : 0;
  const titleDuration = openingTitle ? resolveOpeningTitleDuration(openingTitle, captions, 3) : 0;
  let visibleCaptions = captions;
  if (openingTitle) visibleCaptions = hideCaptionsUntil(visibleCaptions, titleDuration);
  if (endCard) visibleCaptions = hideCaptionsAfter(visibleCaptions, endStart);
  const filters = [];
  const titleFilter = buildOpeningTitleDrawtext({
    title: openingTitle,
    fontFile,
    textFile: path.join(workFolder, "opening-title.txt"),
    durationSeconds: titleDuration || 3,
    width
  });
  if (titleFilter) filters.push(titleFilter);
  if (Array.isArray(visibleCaptions?.cues) && visibleCaptions.cues.length) {
    const assPath = path.join(workFolder, "captions.ass");
    const ass = subtitleAnimationMode === "word-pop" && Array.isArray(visibleCaptions?.words) && visibleCaptions.words.length
      ? makeWordPopSubtitles(visibleCaptions.words, { width, height, fontFile, fontSize: subtitleFontSize, yPercent: subtitleYPercent })
      : subtitleAnimationMode === "word-highlight" && Array.isArray(visibleCaptions?.words) && visibleCaptions.words.length
        ? makeWordHighlightSubtitles(visibleCaptions.cues, visibleCaptions.words, { width, height, fontFile, fontSize: subtitleFontSize, yPercent: subtitleYPercent })
        : makeAssSubtitles(visibleCaptions.cues, { width, height, fontFile, fontSize: subtitleFontSize, yPercent: subtitleYPercent });
    fs.writeFileSync(assPath, ass, "utf8");
    filters.push(`subtitles='${ffPath(assPath).replace(/'/g, "\\'")}'`);
  }
  const badgeFilter = buildNovelBadgeDrawtext({
    badge: novelBadge,
    fontFile,
    textFile: path.join(workFolder, "novel-badge.txt"),
    enable: endCard ? `lt(t,${endStart.toFixed(2)})` : ""
  });
  if (badgeFilter) filters.push(badgeFilter);
  const iconPath = endCard
    ? renderNovelAppIcon({
      platform: endCard.platform,
      destPath: path.join(workFolder, `end-card-icon-${endCard.icon?.key || "app"}.png`),
      fontFile
    })
    : "";
  if (endCard) {
    filters.push(buildEndCardDimFilter(endStart));
    filters.push(...buildNovelEndCardDrawtext({
      card: endCard,
      fontFile,
      startAt: endStart,
      width,
      height
    }));
  }
  return { filters, iconPath, endStart };
}

async function renderClips({ clips, videoMeta, usage, runDir, concatVideo, width, height, fps, quality, dedup, overlayFiles, warnings = [] }) {
  const listPath = path.join(runDir, "concat.txt");
  const planPath = path.join(runDir, "clip-plan.json");
  const overlayIndexes = pickOverlayIndexes(clips.length, dedup.overlayCount, overlayFiles.length);
  const failedAssetIds = new Set();
  const encodeArgs = clipVideoEncodeArgs(quality);
  const clipPaths = clips.map((_, index) => path.join(runDir, `clip-${String(index).padStart(4, "0")}.mp4`));

  writeClipPlan(planPath, clips);
  await mapLimit(clips, clipRenderConcurrency(), async (_clip, index) => {
    const clipPath = clipPaths[index];
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const clip = clips[index];
      try {
        try { fs.rmSync(clipPath, { force: true }); } catch { /* best effort */ }
        await renderSingleClip({ clip, clipPath, index, overlayIndexes, overlayFiles, width, height, fps, encodeArgs, dedup });
        return;
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
    const clip = clips[index];
    throw new Error(`无法渲染素材片段 ${index + 1}/${clips.length}：${path.basename(clip.file)}，起点 ${round2(clip.start)} 秒。${lastError?.message || "FFmpeg 未返回详细错误"}`);
  });
  writeClipPlan(planPath, clips);

  fs.writeFileSync(listPath, clipPaths.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  run("ffmpeg", ["-y", "-hide_banner", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", concatVideo]);
}

async function renderSingleClip({ clip, clipPath, index, overlayIndexes, overlayFiles, width, height, fps, encodeArgs, dedup }) {
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
      "-map", "[out]", "-an", ...encodeArgs, clipPath
    );
    await runAsync("ffmpeg", args);
    return;
  }
  await runAsync("ffmpeg", [
    "-y", "-hide_banner",
    "-ss", String(Math.max(0, clip.start)),
    "-t", String(inputDuration),
    "-i", clip.file,
    "-vf", filter,
    "-an", ...encodeArgs, clipPath
  ]);
}

function clipRenderConcurrency() {
  return hasNvencEncoder() ? 3 : 2;
}

async function mapLimit(items, limit, worker) {
  const total = Array.isArray(items) ? items.length : 0;
  if (!total) return;
  const size = Math.max(1, Math.min(Number(limit) || 1, total));
  let next = 0;
  async function pump() {
    while (next < total) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: size }, () => pump()));
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
    const mirror = Math.random() * 100 < dedup.mirrorChance;
    const scaledWidth = Math.ceil(width * scaleFactor / 2) * 2;
    const scaledHeight = Math.ceil(height * scaleFactor / 2) * 2;
    filters.push(`scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase`);
    if (mirror) filters.push("hflip");
    filters.push(`crop=${width}:${height}`);
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

function muxAudioAndCaptions({ inputVideo, audioPath, outputPath, captions, width, height, fontFile, subtitleFontSize, subtitleYPercent, subtitleAnimationMode, duration, novelBadge, openingTitle = "", endCard = null, quality = "fast" }) {
  const workFolder = path.dirname(inputVideo);
  const finish = buildFinishVideoFilters({
    workFolder,
    captions,
    width,
    height,
    fontFile,
    subtitleFontSize,
    subtitleYPercent,
    subtitleAnimationMode,
    duration,
    novelBadge,
    openingTitle,
    endCard
  });
  const encode = resolveFinalEncode(quality);
  const args = ["-y", "-hide_banner", "-i", inputVideo, "-i", audioPath];
  if (finish.iconPath) args.push("-i", finish.iconPath);
  args.push("-t", String(duration));
  if (finish.iconPath) {
    const pre = finish.filters.length ? finish.filters.join(",") : "format=yuv420p";
    const iconY = Math.round((Number(height) || 1920) * 0.22);
    args.push(
      "-filter_complex",
      `[0:v]${pre}[dec];[2:v]scale=220:220,format=rgba[icon];[dec][icon]overlay=x=(W-w)/2:y=${iconY}:enable='gte(t,${finish.endStart.toFixed(2)})'[vout]`,
      "-map", "[vout]",
      "-map", "1:a:0",
      ...finalVideoEncodeArgs(quality)
    );
  } else if (finish.filters.length) {
    args.push(
      "-vf", finish.filters.join(","),
      "-map", "0:v:0",
      "-map", "1:a:0",
      ...finalVideoEncodeArgs(quality)
    );
  } else {
    args.push("-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy");
  }
  args.push("-shortest", "-c:a", "aac", "-b:a", encode.audio, "-movflags", "+faststart", outputPath);
  run("ffmpeg", args);
}

function resolveFinalEncode(quality) {
  return {
    bitrate: "2000k",
    maxrate: "2000k",
    bufsize: "4000k",
    audio: quality === "quality" ? "160k" : "128k",
    preset: quality === "quality" ? "medium" : "fast"
  };
}

function hasNvencEncoder() {
  if (hasNvencEncoder.cached != null) return hasNvencEncoder.cached;
  const result = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8", windowsHide: true });
  hasNvencEncoder.cached = /\bh264_nvenc\b/.test(String(result.stdout || ""));
  return hasNvencEncoder.cached;
}

function clipVideoEncodeArgs(quality = "fast") {
  return finalVideoEncodeArgs(quality);
}

function finalVideoEncodeArgs(quality = "fast") {
  const encode = resolveFinalEncode(quality);
  if (hasNvencEncoder()) {
    return [
      "-c:v", "h264_nvenc",
      "-preset", quality === "quality" ? "p5" : "p4",
      "-rc", "cbr",
      "-b:v", encode.bitrate,
      "-maxrate", encode.maxrate,
      "-bufsize", encode.bufsize,
      "-pix_fmt", "yuv420p",
      "-profile:v", "high"
    ];
  }
  return [
    "-c:v", "libx264",
    "-preset", encode.preset,
    "-b:v", encode.bitrate,
    "-maxrate", encode.maxrate,
    "-bufsize", encode.bufsize,
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-level", "4.1"
  ];
}

function resolveBadgeFont(fontFile) {
  const bold = "C:/Windows/Fonts/msyhbd.ttc";
  if (fs.existsSync(bold)) return bold;
  return fontFile || "C:/Windows/Fonts/msyh.ttc";
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

function runAsync(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";
    child.stderr?.setEncoding("utf8");
    child.stdout?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 20 * 1024 * 1024) stderr = stderr.slice(-2 * 1024 * 1024);
    });
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 2 * 1024 * 1024) stdout = stdout.slice(-2 * 1024 * 1024);
    });
    child.on("error", (error) => {
      reject(new Error(`${command} failed to start: ${error.message}`));
    });
    child.on("close", (status, signal) => {
      if (status === 0) {
        resolve();
        return;
      }
      const output = String(stderr || stdout || "").trim();
      const tail = output ? output.slice(-2400) : `signal=${signal || "none"}`;
      const commandLine = [command, ...args].map((value) => /\s/.test(String(value)) ? JSON.stringify(String(value)) : String(value)).join(" ");
      reject(new Error(`${command} failed with exit code ${status}: ${tail}\nCommand: ${commandLine}`));
    });
  });
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
  return String(value || "reddit-mix").trim().replace(/[<>:"/\\|?*'`\x00-\x1F]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "reddit-mix";
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
