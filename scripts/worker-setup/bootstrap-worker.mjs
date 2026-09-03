// Configure this machine as a Local Factory worker from scratch. Nothing is
// copied from another worker: rendering defaults come from config.example.json
// in the repo, shared service keys come from the factory cloud
// (GET /api/worker/bootstrap, protected by the same worker token), and the
// asset/audio folders are whatever this machine has.
//
//   node scripts/worker-setup/bootstrap-worker.mjs --token <工厂 WORKER_TOKEN> --worker-id worker-2 \
//     --asset-root E:\视频素材 --audio-root E:\音频目录 [--data-dir D:\localfactory-data] \
//     [--factory-url https://factory.tiktokaitool.com] [--label 老家那台] [--render-concurrency 2] \
//     [--elevenlabs-key ...] [--desk-api-key ...] [--desk-url https://tiktokaitool.com]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_FACTORY_URL = "https://factory.tiktokaitool.com";
export const SECONDARY_RENDER_JOB_TYPES = ["auto-task", "reddit-mix"];
const WINDOWS_FONT = "C:/Windows/Fonts/msyh.ttc";

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

export async function fetchBootstrap({ factoryUrl, token, fetchImpl = fetch }) {
  const response = await fetchImpl(`${factoryUrl.replace(/\/+$/, "")}/api/worker/bootstrap`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (response.status === 401) throw new Error("工厂 token 不对（401）。用 Cloudflare 里 tiktok-factory 的 WORKER_TOKEN。");
  if (!response.ok) throw new Error(`工厂云返回 ${response.status}，无法读取共享配置。`);
  return response.json();
}

export function buildWorkerConfig(example, { dataDir, assetLibraryRoot, audioLibraryRoot, elevenLabsApiKey, fontFile = "" }) {
  const data = slashes(dataDir);
  return {
    ...example,
    fontFile: fontFile || example.fontFile || "",
    elevenLabsApiKey: String(elevenLabsApiKey || example.elevenLabsApiKey || ""),
    workDir: `${data}/work`,
    outputDir: `${data}/outputs`,
    assetLibraryRoot: slashes(assetLibraryRoot),
    audioLibraryRoot: slashes(audioLibraryRoot)
  };
}

export function buildWorkerSettings({ factoryUrl, token, workerId, label = "", renderConcurrency = 2 }) {
  const id = String(workerId || "").trim();
  if (!id) throw new Error("--worker-id 不能为空。");
  if (id === "windows-local") throw new Error("windows-local 已经是另一台机器的 workerId，换一个（例如 worker-2）。");
  if (!String(token || "").trim()) throw new Error("--token 不能为空（工厂的 WORKER_TOKEN）。");
  const concurrency = Math.min(8, Math.max(1, Math.floor(Number(renderConcurrency) || 2)));
  return {
    url: String(factoryUrl || DEFAULT_FACTORY_URL).replace(/\/+$/, ""),
    token: String(token).trim(),
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

export async function bootstrapWorker({
  root,
  token,
  workerId,
  label,
  factoryUrl = DEFAULT_FACTORY_URL,
  assetLibraryRoot,
  audioLibraryRoot,
  dataDir = "D:/localfactory-data",
  renderConcurrency,
  elevenLabsApiKey = "",
  deskApiKey = "",
  deskUrl = "",
  fetchImpl = fetch,
  fontFile = fs.existsSync(WINDOWS_FONT) ? WINDOWS_FONT : ""
}) {
  for (const [flag, value] of [["--asset-root", assetLibraryRoot], ["--audio-root", audioLibraryRoot]]) {
    if (!value) throw new Error(`缺 ${flag}。`);
    if (!fs.existsSync(value) || !fs.statSync(value).isDirectory()) throw new Error(`${flag} 指向的目录不存在：${value}`);
  }
  const settings = buildWorkerSettings({ factoryUrl, token, workerId, label, renderConcurrency });
  const remote = await fetchBootstrap({ factoryUrl: settings.url, token: settings.token, fetchImpl });
  const elevenLabs = String(elevenLabsApiKey || remote.elevenLabsApiKey || "").trim();
  const desk = {
    baseUrl: String(deskUrl || remote.signalDesk?.baseUrl || "https://tiktokaitool.com").replace(/\/+$/, ""),
    apiKey: String(deskApiKey || remote.signalDesk?.apiKey || "").trim()
  };
  const warnings = [];
  if (!elevenLabs) warnings.push("没有 ElevenLabs API Key：字幕识别会失败。加 --elevenlabs-key 重跑，或在工厂云配 ELEVENLABS_API_KEY。");
  if (!desk.apiKey) warnings.push("没有中台 API Key：出片后无法提交官方发布。加 --desk-api-key 重跑，或在工厂云配 SIGNAL_DESK_BRIDGE_KEY。");

  const example = JSON.parse(fs.readFileSync(path.join(root, "config.example.json"), "utf8"));
  const config = buildWorkerConfig(example, { dataDir, assetLibraryRoot, audioLibraryRoot, elevenLabsApiKey: elevenLabs, fontFile });
  fs.mkdirSync(config.workDir, { recursive: true });
  fs.mkdirSync(config.outputDir, { recursive: true });
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(config.workDir, "factory-cloud-worker.json"), JSON.stringify(settings, null, 2));
  fs.writeFileSync(path.join(config.workDir, "official-tiktok-analytics-settings.json"), JSON.stringify({ ...desk, updatedAt: Date.now() }, null, 2));
  if (remote.redditMixSettings && typeof remote.redditMixSettings === "object" && Object.keys(remote.redditMixSettings).length) {
    fs.writeFileSync(path.join(config.workDir, "reddit-mix-settings.json"), JSON.stringify(remote.redditMixSettings, null, 2));
  }
  return { config, settings, desk: { baseUrl: desk.baseUrl, hasApiKey: Boolean(desk.apiKey) }, hasElevenLabsKey: Boolean(elevenLabs), warnings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  bootstrapWorker({
    root,
    token: args.token,
    workerId: args.workerId,
    label: args.label,
    factoryUrl: args.factoryUrl || DEFAULT_FACTORY_URL,
    assetLibraryRoot: args.assetRoot,
    audioLibraryRoot: args.audioRoot,
    dataDir: args.dataDir,
    renderConcurrency: args.renderConcurrency,
    elevenLabsApiKey: args.elevenlabsKey,
    deskApiKey: args.deskApiKey,
    deskUrl: args.deskUrl
  }).then((result) => {
    console.log(`config.json 已写到 ${path.join(root, "config.json")}（素材 ${result.config.assetLibraryRoot}，音频 ${result.config.audioLibraryRoot}）`);
    console.log(`工人配置已写到 ${path.join(result.config.workDir, "factory-cloud-worker.json")}（workerId=${result.settings.workerId}，只接指定给本机的任务）`);
    console.log(`中台：${result.desk.baseUrl}，API Key ${result.desk.hasApiKey ? "已配置" : "缺失"}；ElevenLabs Key ${result.hasElevenLabsKey ? "已配置" : "缺失"}`);
    for (const warning of result.warnings) console.warn(`警告：${warning}`);
  }).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
