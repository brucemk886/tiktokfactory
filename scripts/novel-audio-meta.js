import fs from "node:fs";
import path from "node:path";

export const NOVEL_AUDIO_META_NAME = "novel.json";

export function normalizeNovelAudioMeta(value = {}) {
  return {
    novelId: String(value.novelId || "").trim(),
    novelTitle: String(value.novelTitle || value.title || "").trim(),
    platform: String(value.platform || value.novelPlatform || "").trim(),
    promotionCode: String(value.promotionCode || value.novelPromotionCode || "").trim(),
    promotionCopy: String(value.promotionCopy || "").trim(),
    bookId: String(value.bookId || value.novelBookId || "").trim()
  };
}

export function novelAudioMetaFrom(item = {}, payload = {}) {
  return normalizeNovelAudioMeta({
    novelId: item.novelId || payload.novelId,
    novelTitle: item.novelTitle || payload.novelTitle || item.title,
    platform: item.platform || payload.platform || payload.novelPlatform,
    promotionCode: item.promotionCode || payload.promotionCode || payload.novelPromotionCode,
    promotionCopy: item.promotionCopy || payload.promotionCopy,
    bookId: item.bookId || payload.bookId || payload.novelBookId
  });
}

export function hasNovelAudioMeta(meta) {
  return Boolean(meta?.platform || meta?.promotionCode || meta?.novelId);
}

export function writeNovelAudioMeta({ dir = "", audioPath = "", novel = {} } = {}) {
  const meta = normalizeNovelAudioMeta(novel);
  if (!hasNovelAudioMeta(meta)) return "";
  const payload = { ...meta, updatedAt: new Date().toISOString() };
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const folder = String(dir || (audioPath ? path.dirname(audioPath) : "")).trim();
  let written = "";
  if (folder) {
    fs.mkdirSync(folder, { recursive: true });
    const folderFile = path.join(folder, NOVEL_AUDIO_META_NAME);
    fs.writeFileSync(folderFile, json, "utf8");
    written = folderFile;
  }
  if (audioPath) {
    const sidecar = `${audioPath}.json`;
    fs.mkdirSync(path.dirname(sidecar), { recursive: true });
    fs.writeFileSync(sidecar, json, "utf8");
    written = sidecar;
  }
  return written;
}

export function readFolderNovelMeta(folderPath) {
  try {
    return normalizeNovelAudioMeta(JSON.parse(fs.readFileSync(path.join(folderPath, NOVEL_AUDIO_META_NAME), "utf8")));
  } catch {
    return normalizeNovelAudioMeta();
  }
}

export function readNovelAudioMeta(audioPath = "") {
  const resolved = String(audioPath || "").trim();
  if (!resolved) return normalizeNovelAudioMeta();
  const dir = path.dirname(resolved);
  const files = [`${resolved}.json`, path.join(dir, NOVEL_AUDIO_META_NAME)];
  for (const file of files) {
    try {
      const meta = normalizeNovelAudioMeta(JSON.parse(fs.readFileSync(file, "utf8")));
      if (hasNovelAudioMeta(meta)) return meta;
    } catch {
      // Missing or invalid sidecar is not an error; try the next file.
    }
  }
  return normalizeNovelAudioMeta();
}
