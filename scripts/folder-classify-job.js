import fs from "node:fs";
import path from "node:path";

const payloadPath = process.argv[2];
const jobPath = process.argv[3];

const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const audioExtensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".opus", ".flac", ".ogg"]);
const categoryNames = {
  video: "视频",
  audio: "音频",
  other: "其他"
};

try {
  main();
} catch (error) {
  patchJob({ status: "failed", percent: 100, message: error.message || "Folder classify failed.", updatedAt: Date.now() });
  process.exitCode = 1;
}

function main() {
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8").replace(/^\uFEFF/, ""));
  const sourceDir = mustBeDirectory(payload.sourceDir, "Source folder");
  const saveDir = path.resolve(String(payload.saveDir || "").trim());
  if (!saveDir) throw new Error("Please select a save folder.");
  fs.mkdirSync(saveDir, { recursive: true });

  const selectedTypes = new Set(Array.isArray(payload.types) ? payload.types : []);
  if (!selectedTypes.size) throw new Error("Please select at least one material type.");
  const includeOneLevelSubfolders = payload.includeOneLevelSubfolders !== false;
  const action = payload.action === "move" ? "move" : "copy";
  const sourceAndSaveAreSame = path.resolve(sourceDir) === path.resolve(saveDir);
  const entries = collectEntries(sourceDir, includeOneLevelSubfolders)
    .filter((entry) => {
      if (sourceAndSaveAreSame) return !Object.values(categoryNames).includes(entry.name);
      return !isSameOrInside(entry.path, saveDir) && !isSameOrInside(saveDir, entry.path);
    });
  if (!entries.length) throw new Error("No files or folders found.");

  const summary = { video: 0, audio: 0, other: 0, skipped: 0, total: entries.length };
  const results = [];

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const category = classifyEntry(entry);
    const percent = Math.max(1, Math.min(99, Math.round((index / entries.length) * 100)));

    if (!selectedTypes.has(category)) {
      summary.skipped += 1;
      patchJob({
        status: "running",
        percent,
        message: `Skipped ${index + 1}/${entries.length}: ${entry.name}`,
        updatedAt: Date.now()
      });
      continue;
    }

    const targetDir = path.join(saveDir, categoryNames[category] || category);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = uniquePath(path.join(targetDir, entry.name));

    patchJob({
      status: "running",
      percent,
      message: `${action === "move" ? "Moving" : "Copying"} ${index + 1}/${entries.length}: ${entry.name}`,
      updatedAt: Date.now()
    });

    if (action === "move") moveEntry(entry.path, targetPath);
    else copyEntry(entry.path, targetPath);

    summary[category] += 1;
    results.push({
      name: entry.name,
      source: entry.path,
      target: targetPath,
      type: category,
      action
    });
  }

  patchJob({
    status: "done",
    percent: 100,
    message: `Classify done: video ${summary.video}, audio ${summary.audio}, other ${summary.other}, skipped ${summary.skipped}.`,
    result: { summary, results },
    updatedAt: Date.now()
  });
}

function collectEntries(sourceDir, includeOneLevelSubfolders) {
  const dirents = fs.readdirSync(sourceDir, { withFileTypes: true });
  const entries = [];
  for (const item of dirents) {
    const fullPath = path.join(sourceDir, item.name);
    if (item.isDirectory()) {
      if (includeOneLevelSubfolders) entries.push({ path: fullPath, name: item.name, isDirectory: true });
      continue;
    }
    if (item.isFile()) entries.push({ path: fullPath, name: item.name, isDirectory: false });
  }
  return entries;
}

function classifyEntry(entry) {
  if (!entry.isDirectory) return classifyExtension(path.extname(entry.name).toLowerCase());
  const counts = { video: 0, audio: 0, other: 0 };
  for (const filePath of listFiles(entry.path)) {
    counts[classifyExtension(path.extname(filePath).toLowerCase())] += 1;
  }
  if (counts.video > 0) return "video";
  if (counts.audio > 0) return "audio";
  return "other";
}

function classifyExtension(extension) {
  if (videoExtensions.has(extension)) return "video";
  if (audioExtensions.has(extension)) return "audio";
  return "other";
}

function listFiles(dir) {
  const results = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, item.name);
      if (item.isDirectory()) stack.push(fullPath);
      else if (item.isFile()) results.push(fullPath);
    }
  }
  return results;
}

function copyEntry(sourcePath, targetPath) {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true });
    return;
  }
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
}

function moveEntry(sourcePath, targetPath) {
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    copyEntry(sourcePath, targetPath);
    fs.rmSync(sourcePath, { recursive: true, force: true });
  }
}

function uniquePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  for (let index = 2; index < 10000; index++) {
    const candidate = path.join(dir, `${base}-${index}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to create unique target path: ${targetPath}`);
}

function isSameOrInside(candidatePath, parentPath) {
  const candidate = path.resolve(candidatePath);
  const parent = path.resolve(parentPath);
  return candidate === parent || candidate.startsWith(parent + path.sep);
}

function mustBeDirectory(value, label) {
  const dir = path.resolve(String(value || "").trim());
  const stat = fs.existsSync(dir) ? fs.statSync(dir) : null;
  if (!stat || !stat.isDirectory()) throw new Error(`${label} does not exist: ${dir}`);
  return dir;
}

function patchJob(patch) {
  const current = fs.existsSync(jobPath) ? JSON.parse(fs.readFileSync(jobPath, "utf8").replace(/^\uFEFF/, "")) : {};
  fs.writeFileSync(jobPath, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}
