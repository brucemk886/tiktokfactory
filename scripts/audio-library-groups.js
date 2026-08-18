import fs from "node:fs";
import path from "node:path";
import { listMediaFiles, normalizeGroupId } from "./asset-library.js";

export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".opus", ".webm", ".ogg", ".flac"];
export const DEFAULT_AUDIO_LIBRARY_ROOT = "F:/音频目录";

export function resolveAudioLibraryRoot(config = {}) {
  return path.resolve(String(config.audioLibraryRoot || DEFAULT_AUDIO_LIBRARY_ROOT).trim() || DEFAULT_AUDIO_LIBRARY_ROOT);
}

export function todayAudioFolderName(date = new Date()) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export function safeNovelFolderName(title = "") {
  const name = String(title || "").trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  return name || "未命名小说";
}

export function resolveTargetAudioDir(config = {}, requested = "", options = {}) {
  const rootDir = resolveAudioLibraryRoot(config);
  const date = options.date instanceof Date ? options.date : new Date();
  const value = String(requested || "").trim();
  if (value && value !== "__today__" && value !== "__novel__") {
    const resolved = path.resolve(value);
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  }
  const folderName = value === "__today__"
    ? todayAudioFolderName(date)
    : safeNovelFolderName(options.novelTitle);
  const folder = path.join(rootDir, folderName);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

export function discoverAudioLibraryGroups(config = {}) {
  const rootDir = resolveAudioLibraryRoot(config);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return [];
  const groups = [];
  const rootFiles = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const files = listMediaFiles(fullPath, AUDIO_EXTENSIONS, { recursive: true });
      groups.push({
        id: normalizeGroupId(entry.name),
        name: entry.name,
        path: fullPath,
        totalAssets: files.length
      });
      continue;
    }
    if (entry.isFile() && AUDIO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      rootFiles.push(fullPath);
    }
  }
  if (rootFiles.length) {
    groups.unshift({
      id: "audio-root",
      name: path.basename(rootDir) || "音频目录",
      path: rootDir,
      totalAssets: rootFiles.length,
      rootOnly: true
    });
  }
  return groups.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hans-CN"));
}

export function listAudioLibraryFiles(config = {}) {
  const rootDir = resolveAudioLibraryRoot(config);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return [];
  return listMediaFiles(rootDir, AUDIO_EXTENSIONS, { recursive: true });
}

export function findAudioInLibrary(hints = [], config = {}, files = null) {
  const list = files || listAudioLibraryFiles(config);
  if (!list.length) return "";
  const wanted = (Array.isArray(hints) ? hints : [hints])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!wanted.length) return "";
  const byBase = new Map(list.map((file) => [path.basename(file).toLowerCase(), file]));
  for (const hint of wanted) {
    const base = path.basename(hint).toLowerCase();
    if (byBase.has(base)) return byBase.get(base);
  }
  for (const hint of wanted) {
    const needle = hint.toLowerCase();
    const hit = list.find((file) => path.basename(file).toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return "";
}
