import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  buildPublishIndex,
  collectGroupPublishVideos,
  dashboardFromSnapshot,
  emptyAssetUsageDashboard,
  normalizeOutputId,
  summarizeAssetImpact,
  summarizePublishImpact
} from "./asset-usage-impact.js";
import { resolveStorageDirs } from "./storage-paths.js";

export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"];
const bucketSeconds = 5;

export function getAssetStore(root) {
  const { workDir } = resolveStorageDirs(root, readJson(path.join(root, "config.json"), {}));
  const baseDir = path.join(workDir, "asset-library");
  return {
    baseDir,
    groupsPath: path.join(baseDir, "groups.json"),
    usagePath: path.join(baseDir, "usage.json")
  };
}

export function ensureAssetStore(root) {
  const store = getAssetStore(root);
  fs.mkdirSync(store.baseDir, { recursive: true });
  if (!fs.existsSync(store.groupsPath)) writeJson(store.groupsPath, { groups: [] });
  if (!fs.existsSync(store.usagePath)) writeJson(store.usagePath, { assets: {}, generated: [] });
  return store;
}

export function listAssetGroups(root) {
  const store = ensureAssetStore(root);
  const data = readJson(store.groupsPath, { groups: [] });
  const usage = readUsage(root);
  return (Array.isArray(data.groups) ? data.groups : []).map((group) => {
    const assets = Array.isArray(group.assets) ? group.assets : [];
    const usedAssets = assets.filter((asset) => usage.assets?.[asset.id]?.usedCount > 0).length;
    return {
      ...group,
      totalAssets: assets.length,
      totalDuration: round2(assets.reduce((sum, asset) => sum + (Number(asset.duration) || 0), 0)),
      usedAssets,
      generatedVideos: (usage.generated || []).filter((item) => item.groupId === group.id).length
    };
  });
}

export function getAssetGroup(root, groupId) {
  const group = listAssetGroups(root).find((item) => item.id === groupId);
  if (!group) throw new Error(`素材组不存在：${groupId}`);
  return group;
}

export function upsertAssetGroup(root, group) {
  const store = ensureAssetStore(root);
  const data = readJson(store.groupsPath, { groups: [] });
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const index = groups.findIndex((item) => item.id === group.id);
  const value = {
    ...group,
    updatedAt: new Date().toISOString()
  };
  if (index >= 0) groups[index] = { ...groups[index], ...value };
  else groups.push({ createdAt: new Date().toISOString(), ...value });
  writeJson(store.groupsPath, { groups });
  return value;
}

export function importExistingAssets(root, { groupName, groupId, inputDir, includeSubfolders = true }) {
  const dir = mustBeDirectory(inputDir, "素材文件夹");
  const id = normalizeGroupId(groupId || groupName || path.basename(dir));
  const files = listMediaFiles(dir, VIDEO_EXTENSIONS, { recursive: includeSubfolders !== false });
  if (!files.length) throw new Error("素材文件夹里没有找到视频文件。");

  const existing = (() => {
    try {
      return getAssetGroup(root, id);
    } catch {
      return null;
    }
  })();
  const currentAssets = Array.isArray(existing?.assets) ? existing.assets : [];
  const knownPaths = new Set(currentAssets.map((asset) => path.resolve(asset.file)));
  const newAssets = files
    .filter((file) => !knownPaths.has(path.resolve(file)))
    .map((file) => ({
      id: makeAssetId(id, file),
      file,
      fileName: path.basename(file),
      duration: probeDuration(file, 0),
      sourceType: "external",
      sourceFile: file,
      sourceStart: 0,
      importedAt: new Date().toISOString()
    }))
    .filter((asset) => asset.duration > 0.5);

  const group = upsertAssetGroup(root, {
    id,
    name: groupName || existing?.name || path.basename(dir),
    sourceDir: dir,
    mode: "external",
    assets: [...currentAssets, ...newAssets]
  });
  return { group, imported: newAssets.length };
}

export function reindexAssetGroup(root, groupId, options = {}) {
  const existing = getAssetGroup(root, groupId);
  const sourceDir = existing.mode === "precut" && existing.outputDir
    ? existing.outputDir
    : existing.sourceDir;
  const dir = mustBeDirectory(sourceDir, "素材组目录");
  const files = listMediaFiles(dir, VIDEO_EXTENSIONS, { recursive: existing.includeSubfolders !== false });
  if (!files.length) throw new Error("素材组目录中没有找到视频文件。");

  const previousByPath = new Map((existing.assets || []).map((asset) => [path.resolve(asset.file), asset]));
  const assets = [];
  let skipped = 0;
  const now = new Date().toISOString();

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const previous = previousByPath.get(path.resolve(file));
    const duration = probeDuration(file, 0);
    if (duration > 0.5) {
      assets.push({
        ...(previous || {}),
        id: previous?.id || makeAssetId(existing.id, file),
        file,
        fileName: path.basename(file),
        duration,
        sourceType: previous?.sourceType || "external",
        sourceFile: previous?.sourceFile || file,
        sourceStart: Number(previous?.sourceStart) || 0,
        importedAt: previous?.importedAt || now,
        indexedAt: now
      });
    } else {
      skipped += 1;
    }
    options.onProgress?.({ processed: index + 1, total: files.length, fileName: path.basename(file) });
  }

  const group = upsertAssetGroup(root, {
    ...existing,
    sourceDir: existing.sourceDir || dir,
    assets,
    indexedAt: now
  });
  return {
    group,
    scanned: files.length,
    indexed: assets.length,
    removed: Math.max(0, (existing.assets || []).length - assets.length),
    skipped
  };
}

export function syncAssetLibraryRoot(root, libraryRoot, options = {}) {
  const rootDir = mustBeDirectory(libraryRoot, "素材总库目录");
  const childDirs = fs.readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), "zh-Hans-CN"));
  if (!childDirs.length) throw new Error("素材总库下没有可作为素材组的二级文件夹。");

  const existingGroups = listAssetGroups(root);
  const results = [];
  let completed = 0;
  for (const groupDir of childDirs) {
    const resolvedDir = path.resolve(groupDir);
    const existing = existingGroups.find((group) => path.resolve(String(group.sourceDir || "")) === resolvedDir);
    const groupId = existing?.id || normalizeGroupId(path.basename(groupDir));
    if (!existing) {
      upsertAssetGroup(root, {
        id: groupId,
        name: path.basename(groupDir),
        sourceDir: groupDir,
        mode: "external",
        includeSubfolders: true,
        assets: []
      });
    }
    const result = reindexAssetGroup(root, groupId, {
      onProgress: ({ processed, total, fileName }) => options.onProgress?.({
        groupName: path.basename(groupDir),
        completedGroups: completed,
        totalGroups: childDirs.length,
        processed,
        total,
        fileName
      })
    });
    results.push({ groupId, groupName: path.basename(groupDir), ...result });
    completed += 1;
    options.onProgress?.({
      groupName: path.basename(groupDir),
      completedGroups: completed,
      totalGroups: childDirs.length,
      processed: 0,
      total: 0,
      fileName: ""
    });
  }
  return { rootDir, groups: results, groupCount: results.length };
}

export function discoverAssetLibraryGroups(root, libraryRoot) {
  const rootDir = path.resolve(String(libraryRoot || "").trim());
  if (!rootDir || !fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return [];
  const existingGroups = listAssetGroups(root);
  const discovered = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const groupDir = path.join(rootDir, entry.name);
    const resolvedDir = path.resolve(groupDir);
    const existing = existingGroups.find((group) => path.resolve(String(group.sourceDir || "")) === resolvedDir);
    const baseId = normalizeGroupId(entry.name);
    const conflicting = existingGroups.find((group) => group.id === baseId && path.resolve(String(group.sourceDir || "")) !== resolvedDir);
    const group = existing || upsertAssetGroup(root, {
      id: conflicting ? `${baseId}-${crypto.createHash("sha1").update(resolvedDir).digest("hex").slice(0, 6)}` : baseId,
      name: entry.name,
      sourceDir: groupDir,
      mode: "external",
      includeSubfolders: true,
      assets: []
    });
    discovered.push({ id: group.id, name: group.name || entry.name, sourceDir: groupDir });
  }
  return discovered;
}

export function readUsage(root) {
  const store = ensureAssetStore(root);
  return readJson(store.usagePath, { assets: {}, generated: [] });
}

export { dashboardFromSnapshot, emptyAssetUsageDashboard, normalizeOutputId };

export function getAssetUsageDashboard(root, groupId = "", options = {}) {
  return dashboardFromSnapshot(buildAssetUsageSnapshot(root, options), groupId);
}

export function buildAssetUsageSnapshot(root, options = {}) {
  const visibleIds = Array.isArray(options.groupIds) && options.groupIds.length ? new Set(options.groupIds) : null;
  const groups = listAssetGroups(root).filter((group) => !visibleIds || visibleIds.has(group.id));
  const usage = readUsage(root);
  const publishIndex = buildPublishIndex(options.publishRecords || []);
  const viewsByVideoId = options.viewsByVideoId instanceof Map
    ? options.viewsByVideoId
    : new Map(Object.entries(options.viewsByVideoId || {}));
  const publicGroups = groups.map(publicUsageGroup);
  const dashboards = {};
  for (const selected of groups) {
    dashboards[selected.id] = buildGroupUsageDashboard(selected, usage, publishIndex, viewsByVideoId);
  }
  return {
    sampledAt: Date.now(),
    groups: publicGroups,
    dashboards
  };
}

function publicUsageGroup(group) {
  return {
    id: group.id,
    name: group.name || group.id,
    totalAssets: group.totalAssets,
    totalDuration: group.totalDuration,
    generatedVideos: group.generatedVideos
  };
}

function buildGroupUsageDashboard(selected, usage, publishIndex = new Map(), viewsByVideoId = new Map()) {
  const folderMap = new Map();
  const assetRows = (selected.assets || []).map((asset) => buildUsageRow(asset, usage.assets?.[asset.id], selected.sourceDir));
  for (const row of assetRows) {
    const entry = folderMap.get(row.folder) || createUsageAggregate(row.folder);
    addUsageRow(entry, row);
    folderMap.set(row.folder, entry);
  }

  const summary = createUsageAggregate(selected.name || selected.id);
  assetRows.forEach((row) => addUsageRow(summary, row));
  const folders = Array.from(folderMap.values())
    .map(finalizeUsageAggregate)
    .sort((a, b) => b.totalDuration - a.totalDuration || a.folder.localeCompare(b.folder, "zh-Hans-CN"));
  const { generatedCount, videos } = collectGroupPublishVideos(selected, usage, publishIndex, viewsByVideoId);

  return {
    group: {
      id: selected.id,
      name: selected.name || selected.id,
      sourceDir: selected.sourceDir || "",
      generatedVideos: selected.generatedVideos || 0
    },
    summary: finalizeUsageAggregate(summary),
    folders,
    impact: summarizePublishImpact(videos, generatedCount || selected.generatedVideos || 0),
    videos: videos.map(({ assetIds, ...video }) => video),
    highReuseAssets: assetRows
      .filter((row) => row.usedCount > 0)
      .sort((a, b) => b.reusePressure - a.reusePressure || b.usedSeconds - a.usedSeconds)
      .slice(0, 20)
      .map((row) => {
        const matched = videos.filter((video) => video.assetIds.includes(row.assetId));
        return {
          fileName: row.fileName,
          folder: row.folder,
          duration: row.duration,
          usedCount: row.usedCount,
          usedSeconds: row.usedSeconds,
          coveragePercent: row.coveragePercent,
          reusedBuckets: row.reusedBuckets,
          maxBucketReuse: row.maxBucketReuse,
          risk: usageRisk(row),
          impact: summarizeAssetImpact(matched),
          matchedVideoIds: [...new Set(matched.map((video) => video.videoId).filter(Boolean))]
        };
      })
  };
}

export function writeUsage(root, usage) {
  const store = ensureAssetStore(root);
  writeJson(store.usagePath, usage);
}

export function recordAssetUsage(root, { groupId, outputId, audioName, clips }) {
  const usage = readUsage(root);
  usage.assets ||= {};
  usage.generated ||= [];
  const now = new Date().toISOString();

  for (const clip of clips || []) {
    if (!clip.assetId) continue;
    const entry = usage.assets[clip.assetId] || {
      usedCount: 0,
      usedSeconds: 0,
      buckets: {},
      lastUsedAt: null
    };
    entry.usedCount += 1;
    entry.usedSeconds = round2((Number(entry.usedSeconds) || 0) + (Number(clip.duration) || 0));
    entry.lastUsedAt = now;
    for (const bucket of coveredBuckets(clip.start, clip.duration)) {
      entry.buckets[bucket] = (entry.buckets[bucket] || 0) + 1;
    }
    usage.assets[clip.assetId] = entry;
  }

  usage.generated.unshift({
    groupId,
    outputId,
    audioName,
    createdAt: now,
    clips: (clips || []).map((clip) => ({
      assetId: clip.assetId,
      fileName: clip.fileName,
      start: round2(clip.start),
      duration: round2(clip.duration),
      buckets: coveredBuckets(clip.start, clip.duration)
    }))
  });
  usage.generated = usage.generated.slice(0, 5000);
  writeUsage(root, usage);
}

export function getGeneratedVideoReuseDetail(root, outputId) {
  const usage = readUsage(root);
  const normalizedOutputId = normalizeOutputId(outputId);
  const generated = Array.isArray(usage.generated) ? usage.generated : [];
  const target = generated.find((item) => normalizeOutputId(item.outputId) === normalizedOutputId);
  if (!target) return null;

  const otherVideos = generated.filter((item) => item !== target);
  const related = new Map();
  let reusedSeconds = 0;
  let sharedAssetClips = 0;
  const clips = (target.clips || []).map((clip, clipIndex) => {
    const overlaps = [];
    const relatedOutputs = new Set();
    for (const other of otherVideos) {
      for (const otherClip of other.clips || []) {
        if (!clip.assetId || otherClip.assetId !== clip.assetId) continue;
        relatedOutputs.add(other.outputId);
        const key = normalizeOutputId(other.outputId);
        const entry = related.get(key) || {
          outputId: other.outputId,
          audioName: other.audioName || "",
          groupId: other.groupId || "",
          sharedSeconds: 0,
          sharedAssets: new Set()
        };
        entry.sharedAssets.add(clip.assetId);
        related.set(key, entry);
        const overlap = overlapRange(clip.start, clip.duration, otherClip.start, otherClip.duration);
        if (!overlap) continue;
        overlaps.push(overlap);
        entry.sharedSeconds += overlap.end - overlap.start;
      }
    }

    const clipReusedSeconds = unionLength(overlaps);
    const duration = Math.max(0, Number(clip.duration) || 0);
    reusedSeconds += clipReusedSeconds;
    if (relatedOutputs.size) sharedAssetClips += 1;
    const assetUsage = usage.assets?.[clip.assetId] || {};
    return {
      index: clipIndex + 1,
      assetId: clip.assetId || "",
      fileName: clip.fileName || "",
      start: round2(clip.start),
      duration: round2(duration),
      end: round2(Number(clip.start || 0) + duration),
      assetUseCount: Math.max(0, Number(assetUsage.usedCount) || 0),
      maxBucketReuse: maxObjectValue(assetUsage.buckets),
      relatedVideoCount: relatedOutputs.size,
      reusedSeconds: round2(clipReusedSeconds),
      reusePercent: duration ? round2(Math.min(100, clipReusedSeconds / duration * 100)) : 0
    };
  });

  const totalSeconds = clips.reduce((sum, clip) => sum + clip.duration, 0);
  return {
    outputId: target.outputId,
    groupId: target.groupId || "",
    audioName: target.audioName || "",
    createdAt: target.createdAt || "",
    summary: {
      clipCount: clips.length,
      totalSeconds: round2(totalSeconds),
      reusedSeconds: round2(reusedSeconds),
      reusePercent: totalSeconds ? round2(Math.min(100, reusedSeconds / totalSeconds * 100)) : 0,
      sharedAssetClips,
      sharedAssetPercent: clips.length ? round2(sharedAssetClips / clips.length * 100) : 0,
      relatedVideoCount: related.size
    },
    clips,
    relatedVideos: Array.from(related.values())
      .map((item) => ({
        ...item,
        sharedSeconds: round2(item.sharedSeconds),
        sharedAssetCount: item.sharedAssets.size,
        sharedAssets: undefined
      }))
      .sort((a, b) => b.sharedSeconds - a.sharedSeconds)
      .slice(0, 50)
  };
}

export function scoreClipReuse(usage, assetId, start, duration) {
  const assetUsage = usage.assets?.[assetId];
  if (!assetUsage) return 0;
  const buckets = coveredBuckets(start, duration);
  const bucketScore = buckets.reduce((sum, bucket) => sum + (assetUsage.buckets?.[bucket] || 0), 0);
  return bucketScore + (Number(assetUsage.usedCount) || 0) * 0.15;
}


function overlapRange(startA, durationA, startB, durationB) {
  const start = Math.max(Number(startA) || 0, Number(startB) || 0);
  const end = Math.min((Number(startA) || 0) + (Number(durationA) || 0), (Number(startB) || 0) + (Number(durationB) || 0));
  return end > start ? { start, end } : null;
}

function unionLength(ranges) {
  if (!ranges.length) return 0;
  const sorted = ranges.slice().sort((a, b) => a.start - b.start);
  let total = 0;
  let start = sorted[0].start;
  let end = sorted[0].end;
  for (let index = 1; index < sorted.length; index++) {
    const range = sorted[index];
    if (range.start <= end) end = Math.max(end, range.end);
    else {
      total += end - start;
      start = range.start;
      end = range.end;
    }
  }
  return total + end - start;
}

function maxObjectValue(value) {
  const values = Object.values(value || {}).map(Number).filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

function buildUsageRow(asset, usageEntry = {}, sourceDir = "") {
  const duration = Math.max(0, Number(asset.duration) || 0);
  const totalBuckets = Math.max(1, Math.ceil(duration / bucketSeconds));
  const bucketValues = Object.values(usageEntry?.buckets || {}).map(Number).filter(Number.isFinite);
  const usedBuckets = bucketValues.filter((count) => count > 0).length;
  const reusedBuckets = bucketValues.filter((count) => count > 1).length;
  const maxBucketReuse = bucketValues.length ? Math.max(...bucketValues) : 0;
  const usedCount = Math.max(0, Number(usageEntry?.usedCount) || 0);
  const usedSeconds = Math.max(0, Number(usageEntry?.usedSeconds) || 0);
  const coveragePercent = round2(Math.min(100, usedBuckets / totalBuckets * 100));
  const reusePressure = round2(reusedBuckets + Math.max(0, usedCount - 1) * 0.5 + Math.max(0, maxBucketReuse - 1) * 2);
  return {
    assetId: asset.id || "",
    fileName: asset.fileName || path.basename(asset.file || ""),
    folder: topLevelFolder(asset.file, sourceDir),
    duration,
    totalBuckets,
    usedBuckets,
    reusedBuckets,
    maxBucketReuse,
    usedCount,
    usedSeconds,
    coveragePercent,
    reusePressure
  };
}

function topLevelFolder(filePath, sourceDir) {
  const relative = sourceDir ? path.relative(sourceDir, filePath || "") : "";
  if (!relative || relative.startsWith("..") || path.dirname(relative) === ".") return "根目录";
  return relative.split(/[\\/]/)[0] || "根目录";
}

function createUsageAggregate(folder) {
  return {
    folder,
    totalAssets: 0,
    usedAssets: 0,
    totalDuration: 0,
    usedSeconds: 0,
    totalBuckets: 0,
    usedBuckets: 0,
    reusedBuckets: 0,
    maxBucketReuse: 0,
    clipUses: 0
  };
}

function addUsageRow(aggregate, row) {
  aggregate.totalAssets += 1;
  aggregate.usedAssets += row.usedCount > 0 ? 1 : 0;
  aggregate.totalDuration += row.duration;
  aggregate.usedSeconds += row.usedSeconds;
  aggregate.totalBuckets += row.totalBuckets;
  aggregate.usedBuckets += row.usedBuckets;
  aggregate.reusedBuckets += row.reusedBuckets;
  aggregate.maxBucketReuse = Math.max(aggregate.maxBucketReuse, row.maxBucketReuse);
  aggregate.clipUses += row.usedCount;
}

function finalizeUsageAggregate(aggregate) {
  const coveragePercent = aggregate.totalBuckets ? round2(Math.min(100, aggregate.usedBuckets / aggregate.totalBuckets * 100)) : 0;
  const freshPercent = round2(Math.max(0, 100 - coveragePercent));
  const reusePressure = round2(aggregate.reusedBuckets + Math.max(0, aggregate.clipUses - aggregate.usedAssets) * 0.5 + Math.max(0, aggregate.maxBucketReuse - 1) * 2);
  return {
    ...aggregate,
    totalDuration: round2(aggregate.totalDuration),
    usedSeconds: round2(aggregate.usedSeconds),
    coveragePercent,
    freshPercent,
    reusePressure,
    risk: usageRisk({ reusedBuckets: aggregate.reusedBuckets, maxBucketReuse: aggregate.maxBucketReuse, reusePressure })
  };
}

function usageRisk(value) {
  if (Number(value.maxBucketReuse) >= 5 || Number(value.reusePressure) >= 30) return "high";
  if (Number(value.maxBucketReuse) >= 2 || Number(value.reusePressure) >= 8) return "medium";
  return "low";
}

export function coveredBuckets(start, duration) {
  const safeStart = Math.max(0, Number(start) || 0);
  const safeEnd = Math.max(safeStart, safeStart + Math.max(0, Number(duration) || 0));
  const first = Math.floor(safeStart / bucketSeconds);
  const last = Math.max(first, Math.floor(Math.max(safeStart, safeEnd - 0.001) / bucketSeconds));
  const buckets = [];
  for (let bucket = first; bucket <= last; bucket++) buckets.push(String(bucket));
  return buckets;
}

export function listMediaFiles(dir, extensions, options = {}) {
  const recursive = options.recursive !== false;
  const results = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, item.name);
      if (item.isDirectory() && recursive) stack.push(fullPath);
      if (item.isFile() && extensions.includes(path.extname(item.name).toLowerCase())) results.push(fullPath);
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

export function probeDuration(filePath, fallback = 0) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath
  ], { encoding: "utf8", windowsHide: true });
  const duration = Number(String(result.stdout || "").trim());
  return Number.isFinite(duration) && duration > 0 ? duration : fallback;
}

export function mustBeDirectory(value, label) {
  const dir = path.resolve(String(value || "").trim());
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`${label}不存在或不是文件夹。`);
  }
  return dir;
}

export function normalizeGroupId(value) {
  return String(value || "asset-group")
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "asset-group";
}

export function makeAssetId(groupId, filePath, extra = "") {
  return `${normalizeGroupId(groupId)}-${crypto.createHash("sha1").update(path.resolve(filePath)).update(extra).digest("hex").slice(0, 12)}`;
}

export function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

export function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}
