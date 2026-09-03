// Run on the primary worker. Bundles everything a second machine needs that is
// not in git (config.json with API keys, the factory token, small *-settings
// files) into one JSON file you can send over WeChat / a USB stick.
//
//   node scripts/worker-setup/export-seed.mjs [--out D:\localfactory-data\worker-seed.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "../video-core.js";
import { resolveStorageDirs } from "../storage-paths.js";

export const SEED_VERSION = 1;

// Anything under work/ that ends in -settings.json is a small credential or
// preference file; publish records, logs, indexes and caches stay behind.
export function listSeedSettingsFiles(workDir) {
  if (!fs.existsSync(workDir)) return [];
  return fs.readdirSync(workDir)
    .filter((name) => /-settings\.json$/i.test(name))
    .sort();
}

export function buildSeed({ config, workDir, workerSettings }) {
  const files = {};
  for (const name of listSeedSettingsFiles(workDir)) {
    try {
      files[name] = JSON.parse(fs.readFileSync(path.join(workDir, name), "utf8"));
    } catch {
      // Skip unreadable/half-written files rather than fail the whole export.
    }
  }
  const { workDir: _w, outputDir: _o, assetLibraryRoot: _a, audioLibraryRoot: _l, ...shared } = config;
  return {
    version: SEED_VERSION,
    exportedAt: new Date().toISOString(),
    config: shared,
    factoryCloud: {
      url: String(workerSettings.url || ""),
      token: String(workerSettings.token || "")
    },
    files
  };
}

function readWorkerSettings(workDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(workDir, "factory-cloud-worker.json"), "utf8"));
  } catch {
    return {};
  }
}

export function exportSeed({ root = process.cwd(), out } = {}) {
  const config = readConfig(root);
  const storage = resolveStorageDirs(root, config);
  const workerSettings = readWorkerSettings(storage.workDir);
  if (!workerSettings.url || !workerSettings.token) {
    throw new Error(`没找到 ${path.join(storage.workDir, "factory-cloud-worker.json")} 里的 url/token，无法导出。`);
  }
  const seed = buildSeed({ config, workDir: storage.workDir, workerSettings });
  const target = out || path.join(path.dirname(storage.workDir), "worker-seed.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(seed, null, 2));
  return { path: target, files: Object.keys(seed.files) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  const result = exportSeed({ out: outIndex > 0 ? process.argv[outIndex + 1] : undefined });
  console.log(`已导出：${result.path}`);
  console.log(`包含 config.json、工厂 token 和 ${result.files.length} 个设置文件：${result.files.join(", ")}`);
  console.log("把这个文件发到新机器，然后在新机器上跑 scripts\\worker-setup\\setup-worker.ps1。里面有密钥，别发到群里。");
}
