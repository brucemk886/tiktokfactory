// Run on the second worker. Turns the seed exported by the primary into this
// machine's config.json, work/factory-cloud-worker.json and settings files.
//
//   node scripts/worker-setup/apply-seed.mjs --seed worker-seed.json --worker-id worker-2 \
//     --asset-root E:\视频素材 --audio-root E:\音频目录 [--data-dir D:\localfactory-data] \
//     [--label 老家那台] [--render-concurrency 2]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SECONDARY_RENDER_JOB_TYPES = ["auto-task", "reddit-mix"];

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function slashes(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

export function buildWorkerConfig(seed, { dataDir, assetLibraryRoot, audioLibraryRoot }) {
  const data = slashes(dataDir);
  return {
    ...(seed.config || {}),
    workDir: `${data}/work`,
    outputDir: `${data}/outputs`,
    assetLibraryRoot: slashes(assetLibraryRoot),
    audioLibraryRoot: slashes(audioLibraryRoot)
  };
}

export function buildWorkerSettings(seed, { workerId, label = "", renderConcurrency = 2 }) {
  const id = String(workerId || "").trim();
  if (!id) throw new Error("--worker-id 不能为空，且要和主机的 workerId 不一样。");
  if (id === "windows-local") throw new Error("windows-local 是主机的 workerId，新机器要换一个。");
  const concurrency = Math.min(8, Math.max(1, Math.floor(Number(renderConcurrency) || 2)));
  return {
    url: String(seed.factoryCloud?.url || "").replace(/\/+$/, ""),
    token: String(seed.factoryCloud?.token || ""),
    workerId: id,
    label: String(label || "").trim(),
    // Only run tasks the creator pinned to this machine; its assets are here only.
    assignedOnly: true,
    pollMs: 60000,
    syncMs: 300000,
    renderConcurrency: concurrency,
    publishConcurrency: 1,
    renderJobTypes: SECONDARY_RENDER_JOB_TYPES
  };
}

export function applySeed({ root, seedPath, workerId, label, assetLibraryRoot, audioLibraryRoot, dataDir, renderConcurrency }) {
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  if (!seed.factoryCloud?.url || !seed.factoryCloud?.token) throw new Error("seed 里没有工厂云的 url/token，请在主机重新导出。");
  for (const [flag, value] of [["--asset-root", assetLibraryRoot], ["--audio-root", audioLibraryRoot]]) {
    if (!value) throw new Error(`缺 ${flag}。`);
    if (!fs.existsSync(value) || !fs.statSync(value).isDirectory()) throw new Error(`${flag} 指向的目录不存在：${value}`);
  }
  const resolvedDataDir = dataDir || "D:/localfactory-data";
  const config = buildWorkerConfig(seed, { dataDir: resolvedDataDir, assetLibraryRoot, audioLibraryRoot });
  const settings = buildWorkerSettings(seed, { workerId, label, renderConcurrency });
  fs.mkdirSync(config.workDir, { recursive: true });
  fs.mkdirSync(config.outputDir, { recursive: true });
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(config.workDir, "factory-cloud-worker.json"), JSON.stringify(settings, null, 2));
  const written = [];
  for (const [name, value] of Object.entries(seed.files || {})) {
    if (!/^[\w.-]+-settings\.json$/i.test(name)) continue;
    fs.writeFileSync(path.join(config.workDir, name), JSON.stringify(value, null, 2));
    written.push(name);
  }
  return { config, settings, files: written };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const result = applySeed({
    root,
    seedPath: args.seed,
    workerId: args.workerId,
    label: args.label,
    assetLibraryRoot: args.assetRoot,
    audioLibraryRoot: args.audioRoot,
    dataDir: args.dataDir,
    renderConcurrency: args.renderConcurrency
  });
  console.log(`config.json 已写到 ${path.join(root, "config.json")}`);
  console.log(`工人配置已写到 ${path.join(result.config.workDir, "factory-cloud-worker.json")}（workerId=${result.settings.workerId}，只接指定给本机的任务）`);
  console.log(`设置文件 ${result.files.length} 个：${result.files.join(", ") || "无"}`);
}
