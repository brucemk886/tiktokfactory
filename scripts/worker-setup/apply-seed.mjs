// Turns the seed folder exported by primary-share.ps1 into a working
// configuration for a secondary worker machine:
//   - config.json with local work/output dirs and UNC library roots
//   - work/asset-library/groups.json with the primary's paths rewritten to UNC
//   - work/factory-cloud-worker.json with its own workerId and a render whitelist
//   - caption cache, audio index and desk settings copied over
//
// Usage (called by worker-bootstrap.ps1, can also be run by hand):
//   node scripts/worker-setup/apply-seed.mjs --seed \\A\factory-seed --root D:\cursor\localfactory \
//     --data D:\localfactory-data --primary A --worker-id windows-2 [--render-types auto-task,reddit-mix] \
//     [--render-concurrency 2] [--force]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_RENDER_TYPES = ["auto-task", "reddit-mix"];

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function uncRoot(host, share) {
  return `//${String(host).trim()}/${String(share).trim()}`;
}

function normalizeForCompare(value) {
  return String(value || "").replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
}

// Rewrites every string that starts with fromRoot (either slash style) so it
// starts with toRoot instead. Objects and arrays are walked recursively; other
// values are returned untouched.
export function rewriteAssetPaths(value, fromRoot, toRoot) {
  const from = normalizeForCompare(fromRoot);
  const toText = String(toRoot);
  const unc = /^[\\/]{2}/.test(toText) ? "\\\\" : "";
  const to = unc + toText.replace(/^[\\/]+/, "").replace(/[\\/]+/g, "\\").replace(/\\+$/, "");
  if (!from) return value;
  const rewrite = (node) => {
    if (typeof node === "string") {
      const normalized = normalizeForCompare(node);
      if (normalized === from) return to;
      if (normalized.startsWith(`${from}/`)) {
        const rest = node.replace(/[\\/]+/g, "\\").slice(from.length);
        return `${to}${rest}`;
      }
      return node;
    }
    if (Array.isArray(node)) return node.map(rewrite);
    if (node && typeof node === "object") {
      const out = {};
      for (const [key, item] of Object.entries(node)) out[key] = rewrite(item);
      return out;
    }
    return node;
  };
  return rewrite(value);
}

export function buildWorkerConfig(seedConfig, { dataDir, assetLibraryRoot, audioLibraryRoot }) {
  const data = String(dataDir).replace(/\\/g, "/").replace(/\/+$/, "");
  // Task payloads still name the primary's absolute folders (F:\音频目录\0708);
  // pathAliases lets reddit-mix-job follow them to the shares.
  const pathAliases = { ...(seedConfig.pathAliases || {}) };
  if (seedConfig.assetLibraryRoot) pathAliases[seedConfig.assetLibraryRoot] = assetLibraryRoot;
  if (seedConfig.audioLibraryRoot) pathAliases[seedConfig.audioLibraryRoot] = audioLibraryRoot;
  return {
    ...seedConfig,
    workDir: `${data}/work`,
    outputDir: `${data}/outputs`,
    assetLibraryRoot,
    audioLibraryRoot,
    pathAliases
  };
}

export function buildWorkerSettings(seedSettings, { workerId, renderTypes, renderConcurrency }) {
  const types = (Array.isArray(renderTypes) ? renderTypes : String(renderTypes || "").split(","))
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const url = String(seedSettings.url || "").trim();
  const token = String(seedSettings.token || "").trim();
  if (!url || !token) throw new Error("seed 里的 factory-cloud-worker.json 缺 url 或 token。");
  const id = String(workerId || "").trim();
  if (!id) throw new Error("必须指定 --worker-id。");
  if (id === String(seedSettings.workerId || "").trim()) {
    throw new Error(`workerId "${id}" 和主机一样，两台机器的 workerId 必须不同。`);
  }
  return {
    url,
    token,
    workerId: id,
    pollMs: Number(seedSettings.pollMs) || 60000,
    syncMs: Number(seedSettings.syncMs) || 300000,
    renderConcurrency: Math.max(1, Math.min(8, Number(renderConcurrency) || 2)),
    publishConcurrency: 1,
    renderJobTypes: types.length ? types : DEFAULT_RENDER_TYPES
  };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw new Error(`读不到 ${file}：${error.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function applySeed({ seedDir, root, dataDir, primary, workerId, renderTypes, renderConcurrency, force = false, log = console.log }) {
  const seed = readJson(path.join(seedDir, "seed.json"));
  const host = String(primary || seed.primaryHost || "").trim();
  if (!host) throw new Error("不知道主机名，传 --primary。");
  const assetLibraryRoot = uncRoot(host, seed.videosShare || "factory-videos");
  const audioLibraryRoot = uncRoot(host, seed.audioShare || "factory-audio");
  const workDir = path.join(dataDir, "work");
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "outputs"), { recursive: true });

  const configPath = path.join(root, "config.json");
  if (fs.existsSync(configPath) && !force) {
    log(`config.json 已存在，保留（--force 覆盖）：${configPath}`);
  } else {
    const seedConfig = readJson(path.join(seedDir, "config.json"));
    writeJson(configPath, buildWorkerConfig(seedConfig, { dataDir, assetLibraryRoot, audioLibraryRoot }));
    log(`已写 config.json：素材 ${assetLibraryRoot}，音频 ${audioLibraryRoot}`);
  }

  const groupsSeed = path.join(seedDir, "asset-library", "groups.json");
  const groupsTarget = path.join(workDir, "asset-library", "groups.json");
  if (fs.existsSync(groupsSeed) && (force || !fs.existsSync(groupsTarget))) {
    const groups = readJson(groupsSeed);
    const rewritten = rewriteAssetPaths(groups, seed.assetLibraryRoot, assetLibraryRoot);
    writeJson(groupsTarget, rewritten);
    const count = Array.isArray(rewritten.groups) ? rewritten.groups.length : 0;
    log(`已导入素材索引 ${count} 组，路径改为 ${assetLibraryRoot}`);
  }
  const usagePath = path.join(workDir, "asset-library", "usage.json");
  if (!fs.existsSync(usagePath)) writeJson(usagePath, { assets: {}, generated: [] });

  const copies = [
    ["official-tiktok-analytics-settings.json", "official-tiktok-analytics-settings.json"],
    [path.join("audio-library", "index.json"), path.join("audio-library", "index.json")]
  ];
  for (const [from, to] of copies) {
    const source = path.join(seedDir, from);
    const target = path.join(workDir, to);
    if (!fs.existsSync(source)) continue;
    if (fs.existsSync(target) && !force) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    log(`已拷 ${to}`);
  }
  const captionSeed = path.join(seedDir, "caption-cache");
  if (fs.existsSync(captionSeed)) {
    fs.cpSync(captionSeed, path.join(workDir, "caption-cache"), { recursive: true, force: false, errorOnExist: false });
    log("已拷 caption-cache");
  }

  const settingsPath = path.join(workDir, "factory-cloud-worker.json");
  if (fs.existsSync(settingsPath) && !force) {
    log(`factory-cloud-worker.json 已存在，保留：${settingsPath}`);
  } else {
    const seedSettings = readJson(path.join(seedDir, "factory-cloud-worker.json"));
    const settings = buildWorkerSettings(seedSettings, { workerId, renderTypes, renderConcurrency });
    writeJson(settingsPath, settings);
    log(`已写 factory-cloud-worker.json：worker=${settings.workerId} 渲染类型=${settings.renderJobTypes.join(",")}`);
  }
  return { assetLibraryRoot, audioLibraryRoot, workDir };
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && invoked.toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase()) {
  const args = parseArgs(process.argv.slice(2));
  try {
    applySeed({
      seedDir: String(args.seed || ""),
      root: path.resolve(String(args.root || process.cwd())),
      dataDir: path.resolve(String(args.data || "D:/localfactory-data")),
      primary: args.primary,
      workerId: args["worker-id"],
      renderTypes: args["render-types"] || DEFAULT_RENDER_TYPES,
      renderConcurrency: args["render-concurrency"],
      force: Boolean(args.force)
    });
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
