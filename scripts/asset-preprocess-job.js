import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  VIDEO_EXTENSIONS,
  importExistingAssets,
  listMediaFiles,
  makeAssetId,
  mustBeDirectory,
  normalizeGroupId,
  probeDuration,
  round2,
  upsertAssetGroup
} from "./asset-library.js";

const payloadPath = process.argv[2];
const jobPath = process.argv[3];
const root = process.cwd();

main().catch((error) => {
  patchJob({ status: "failed", percent: 100, message: error.message || "素材预处理失败。", updatedAt: Date.now() });
  process.exitCode = 1;
});

async function main() {
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const mode = String(payload.mode || "cut");

  if (mode === "import") {
    const result = importExistingAssets(root, {
      groupName: payload.groupName,
      groupId: payload.groupId,
      inputDir: payload.inputDir,
      includeSubfolders: payload.includeSubfolders !== false
    });
    patchJob({
      status: "done",
      percent: 100,
      message: `素材导入完成：新增 ${result.imported} 条素材。`,
      result,
      updatedAt: Date.now()
    });
    return;
  }

  const inputDir = mustBeDirectory(payload.inputDir, "长视频文件夹");
  const outputDir = path.resolve(String(payload.outputDir || "").trim());
  if (!outputDir) throw new Error("请输入输出素材库文件夹。");
  fs.mkdirSync(outputDir, { recursive: true });

  const groupId = normalizeGroupId(payload.groupId || payload.groupName || path.basename(outputDir));
  const groupName = String(payload.groupName || groupId).trim();
  const minSeconds = clampNumber(payload.minSeconds, 15, 120, 45);
  const maxSeconds = Math.max(minSeconds, clampNumber(payload.maxSeconds, minSeconds, 180, 75));
  const sourceLimitSeconds = Math.max(0, Number(payload.sourceLimitSeconds) || 0);
  const width = clampNumber(payload.width, 480, 2160, 1080);
  const height = clampNumber(payload.height, 480, 3840, 1920);
  const fps = clampNumber(payload.fps, 24, 60, 30);
  const quality = String(payload.quality || "fast");
  const fastCopy = quality === "fast";
  const preset = quality === "quality" ? "medium" : "veryfast";
  const crf = quality === "quality" ? "20" : "24";
  const files = listMediaFiles(inputDir, VIDEO_EXTENSIONS, { recursive: payload.includeSubfolders !== false });
  if (!files.length) throw new Error("长视频文件夹里没有找到视频文件。");

  const assets = [];
  let processedSources = 0;
  let clipIndex = 0;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const sourceFile = files[fileIndex];
    const sourceDuration = probeDuration(sourceFile, 0);
    if (sourceDuration <= 1) continue;
    const limit = sourceLimitSeconds > 0 ? Math.min(sourceDuration, sourceLimitSeconds) : sourceDuration;
    let start = 0;

    while (start + 1 < limit) {
      const segmentDuration = Math.min(randomBetween(minSeconds, maxSeconds), limit - start);
      if (segmentDuration < 3) break;
      clipIndex += 1;
      const fileBase = `${groupId}-${String(clipIndex).padStart(5, "0")}`;
      const outputPath = path.join(outputDir, `${fileBase}.mp4`);

      patchJob({
        status: "running",
        percent: Math.min(99, Math.round(((fileIndex + start / Math.max(1, limit)) / files.length) * 100)),
        message: `切割素材：${path.basename(sourceFile)} ${round2(start)}-${round2(start + segmentDuration)} 秒`,
        updatedAt: Date.now()
      });

      if (fastCopy) {
        run("ffmpeg", [
          "-y",
          "-hide_banner",
          "-ss", String(start),
          "-t", String(segmentDuration),
          "-i", sourceFile,
          "-map", "0:v:0",
          "-an",
          "-c:v", "copy",
          "-avoid_negative_ts", "make_zero",
          outputPath
        ]);
      } else {
        run("ffmpeg", [
          "-y",
          "-hide_banner",
          "-ss", String(start),
          "-t", String(segmentDuration),
          "-i", sourceFile,
          "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps},format=yuv420p`,
          "-an",
          "-c:v", "libx264",
          "-preset", preset,
          "-crf", crf,
          outputPath
        ]);
      }

      assets.push({
        id: makeAssetId(groupId, outputPath, `${sourceFile}:${start}`),
        file: outputPath,
        fileName: path.basename(outputPath),
        duration: probeDuration(outputPath, segmentDuration),
        sourceType: "precut",
        sourceFile,
        sourceStart: round2(start),
        sourceDuration: round2(segmentDuration),
        importedAt: new Date().toISOString()
      });
      start += segmentDuration;
    }
    processedSources += 1;
  }

  const group = upsertAssetGroup(root, {
    id: groupId,
    name: groupName,
    mode: "precut",
    sourceDir: inputDir,
    outputDir,
    cutSettings: { minSeconds, maxSeconds, sourceLimitSeconds, width, height, fps, quality, cutMode: fastCopy ? "fast-copy" : "reencode" },
    assets
  });

  patchJob({
    status: "done",
    percent: 100,
    message: `素材组完成：${group.name}，${assets.length} 条素材，来源 ${processedSources} 个视频。`,
    result: { group, assets: assets.length, processedSources },
    updatedAt: Date.now()
  });
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}: ${(result.stderr || result.stdout || "").slice(0, 1800)}`);
  }
}

function patchJob(patch) {
  const current = fs.existsSync(jobPath) ? JSON.parse(fs.readFileSync(jobPath, "utf8")) : {};
  fs.writeFileSync(jobPath, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
