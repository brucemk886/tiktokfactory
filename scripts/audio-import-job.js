import fs from "node:fs";
import path from "node:path";
import { createAudioLibraryService } from "./audio-library.js";
import { resolveTargetAudioDir } from "./audio-library-groups.js";
import { novelAudioMetaFrom, writeNovelAudioMeta } from "./novel-audio-meta.js";
import { readConfig } from "./video-core.js";

export async function runAudioImportJob({
  root = process.cwd(),
  workDir,
  config = null,
  payload = {},
  onProgress = null,
  audioLibrary = null,
  fetchImpl = fetch,
  cloudUrl = "",
  workerToken = "",
  workerId = ""
} = {}) {
  const bootConfig = config || readConfig(root);
  const library = audioLibrary || createAudioLibraryService({
    root,
    workDir,
    readConfig: () => bootConfig
  });
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw Object.assign(new Error("没有可导入的音频。"), { statusCode: 400 });
  const targetAudioDir = resolveTargetAudioDir(bootConfig, payload.targetAudioDir, {
    novelTitle: payload.novelTitle || items[0]?.novelTitle
  });
  const tempDir = path.join(workDir || root, "imported-audio");
  fs.mkdirSync(tempDir, { recursive: true });
  const results = [];
  const failed = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    onProgress?.({
      current: index,
      total: items.length,
      percent: Math.max(8, Math.round((index / items.length) * 90)),
      message: `正在把第 ${index + 1}/${items.length} 条上传音频写到本机...`
    });
    try {
      const audioId = String(item.audioId || "").trim();
      if (!audioId) throw new Error("缺少音频 ID。");
      const sourcePath = await downloadCloudAudio({
        audioId,
        destPath: path.join(tempDir, `${audioId}.mp3`),
        fetchImpl,
        cloudUrl,
        workerToken,
        workerId
      });
      const record = library.importExistingFile({
        id: audioId,
        title: item.title || path.basename(String(item.fileName || "上传音频"), path.extname(String(item.fileName || ""))),
        sourcePath,
        targetAudioDir,
        novelId: item.novelId,
        scriptId: item.scriptId,
        sourceType: "uploaded-audio"
      });
      writeNovelAudioMeta({
        dir: targetAudioDir,
        audioPath: record.targetAudioPath,
        novel: novelAudioMetaFrom(item, payload)
      });
      results.push({
        scriptId: String(item.scriptId || "").trim(),
        novelId: String(item.novelId || "").trim(),
        audioId: record.id,
        fileName: record.fileName || item.fileName || "",
        title: record.title,
        targetAudioPath: record.targetAudioPath || targetAudioDir,
        duration: Number(record.duration) || 0,
        size: Number(record.size) || 0,
        createdAt: record.createdAt || new Date().toISOString()
      });
    } catch (error) {
      failed.push({
        scriptId: String(item.scriptId || "").trim(),
        audioId: String(item.audioId || "").trim(),
        error: error.message || "导入失败"
      });
    }
  }
  if (!results.length) {
    throw Object.assign(new Error(failed[0]?.error || "上传音频没有写到本机。"), { statusCode: 502 });
  }
  return {
    targetAudioDir,
    items: results,
    failed,
    progressCurrent: results.length,
    progressTotal: items.length
  };
}

async function downloadCloudAudio({ audioId, destPath, fetchImpl, cloudUrl, workerToken, workerId }) {
  const response = await fetchImpl(`${String(cloudUrl || "").replace(/\/+$/, "")}/api/worker/audio/${encodeURIComponent(audioId)}`, {
    headers: {
      Authorization: `Bearer ${workerToken}`,
      "x-factory-worker": workerId || "worker"
    }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `下载上传音频失败：HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) throw new Error("下载的音频文件太小。");
  fs.writeFileSync(destPath, buffer);
  return destPath;
}
