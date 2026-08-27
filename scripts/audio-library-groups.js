import fs from "node:fs";
import path from "node:path";
import { listMediaFiles, normalizeGroupId } from "./asset-library.js";
import { readFolderNovelMeta } from "./novel-audio-meta.js";

export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".opus", ".webm", ".ogg", ".flac"];
export const DEFAULT_AUDIO_LIBRARY_ROOT = "F:/音频目录";
export const NOVEL_AUDIO_PLATFORMS = Object.freeze(["GoodNovel", "MotoNovel", "NovelMaster"]);
export const UNASSIGNED_AUDIO_PLATFORM = "未分平台";

const PLATFORM_ORDER = Object.freeze({
  GoodNovel: 0,
  MotoNovel: 1,
  NovelMaster: 2,
  [UNASSIGNED_AUDIO_PLATFORM]: 3
});

const KIND_ORDER = Object.freeze({
  platform: 0,
  "legacy-bundle": 1,
  book: 2,
  legacy: 3,
  batch: 4
});

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

export function safePlatformFolderName(platform = "") {
  const raw = String(platform || "").replace(/\s+/g, "");
  if (/^goodnovel$/i.test(raw)) return "GoodNovel";
  if (/^motonovel$/i.test(raw)) return "MotoNovel";
  if (/^novelmaster$/i.test(raw)) return "NovelMaster";
  return UNASSIGNED_AUDIO_PLATFORM;
}

export function isNovelAudioPlatformFolder(name = "") {
  const trimmed = String(name || "").trim();
  if (trimmed === UNASSIGNED_AUDIO_PLATFORM) return true;
  const raw = trimmed.replace(/\s+/g, "");
  return NOVEL_AUDIO_PLATFORMS.some((item) => item.toLowerCase() === raw.toLowerCase());
}

export function isDateAudioFolderName(name = "") {
  return /^\d{4}$/.test(String(name || "").trim());
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
  if (value === "__today__") {
    const folder = path.join(rootDir, todayAudioFolderName(date));
    fs.mkdirSync(folder, { recursive: true });
    return folder;
  }
  const folder = path.join(
    rootDir,
    safePlatformFolderName(options.platform),
    safeNovelFolderName(options.novelTitle)
  );
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

export function normalizeAudioDirs(...values) {
  const dirs = [];
  const seen = new Set();
  const add = (value) => {
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    const dir = String(value || "").trim();
    if (!dir) return;
    const key = dir.replace(/[\\/]+/g, "/").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    dirs.push(dir);
  };
  values.forEach(add);
  return dirs;
}

export function discoverAudioLibraryGroups(config = {}) {
  const rootDir = resolveAudioLibraryRoot(config);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return [];
  const groups = [];
  const legacyBooks = [];
  const rootFiles = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (isNovelAudioPlatformFolder(entry.name)) {
        groups.push(...discoverPlatformFolder(fullPath, entry.name));
        continue;
      }
      if (isDateAudioFolderName(entry.name)) {
        groups.push(collectFolderGroup(fullPath, {
          kind: "batch",
          name: entry.name
        }));
        continue;
      }
      legacyBooks.push(collectFolderGroup(fullPath, {
        kind: "legacy",
        name: entry.name
      }));
      continue;
    }
    if (entry.isFile() && AUDIO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      rootFiles.push(fullPath);
    }
  }
  groups.push(...legacyBooks);
  const voicedLegacy = legacyBooks.filter((item) => Number(item.totalAssets) > 0);
  if (voicedLegacy.length) {
    groups.push({
      id: "legacy-root-books",
      kind: "legacy-bundle",
      name: "旧文件夹",
      platform: UNASSIGNED_AUDIO_PLATFORM,
      path: voicedLegacy[0].path,
      paths: voicedLegacy.map((item) => item.path),
      totalAssets: voicedLegacy.reduce((sum, item) => sum + (Number(item.totalAssets) || 0), 0),
      bookCount: voicedLegacy.length
    });
  }
  if (rootFiles.length) {
    groups.unshift({
      id: "audio-root",
      kind: "root",
      name: path.basename(rootDir) || "音频目录",
      path: rootDir,
      totalAssets: rootFiles.length,
      rootOnly: true
    });
  }
  return sortAudioLibraryGroups(groups);
}

function discoverPlatformFolder(fullPath, folderName) {
  const platform = isNovelAudioPlatformFolder(folderName)
    ? (folderName.trim() === UNASSIGNED_AUDIO_PLATFORM ? UNASSIGNED_AUDIO_PLATFORM : safePlatformFolderName(folderName))
    : UNASSIGNED_AUDIO_PLATFORM;
  const platformId = normalizeGroupId(`platform-${platform}`);
  const books = [];
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
    for (const entry of fs.readdirSync(fullPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      books.push(collectFolderGroup(path.join(fullPath, entry.name), {
        kind: "book",
        name: entry.name,
        platform,
        parentId: platformId
      }));
    }
  }
  const files = listMediaFiles(fullPath, AUDIO_EXTENSIONS, { recursive: true });
  return [
    {
      id: platformId,
      kind: "platform",
      name: platform,
      platform,
      path: fullPath,
      totalAssets: files.length,
      bookCount: books.filter((item) => Number(item.totalAssets) > 0).length
    },
    ...books
  ];
}

function collectFolderGroup(fullPath, options = {}) {
  const files = listMediaFiles(fullPath, AUDIO_EXTENSIONS, { recursive: true });
  const meta = readFolderNovelMeta(fullPath);
  const name = options.name || path.basename(fullPath);
  const platform = options.platform || meta.platform || "";
  return {
    id: normalizeGroupId([options.parentId ? platform : "", name].filter(Boolean).join("-") || name),
    kind: options.kind || "book",
    name,
    path: fullPath,
    platform,
    parentId: options.parentId || "",
    totalAssets: files.length,
    bookCount: files.length ? 1 : 0,
    novelId: meta.novelId,
    promotionCode: meta.promotionCode,
    promotionCopy: meta.promotionCopy
  };
}

function sortAudioLibraryGroups(groups) {
  return groups.sort((a, b) => {
    const kind = (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9);
    if (kind) return kind;
    const platformA = PLATFORM_ORDER[a.platform || a.name] ?? 9;
    const platformB = PLATFORM_ORDER[b.platform || b.name] ?? 9;
    if (platformA !== platformB) return platformA - platformB;
    return String(a.name).localeCompare(String(b.name), "zh-Hans-CN");
  });
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
