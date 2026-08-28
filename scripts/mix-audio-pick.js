import fs from "node:fs";
import path from "node:path";

export function audioHitWeight(playCount = 0) {
  return 1 + Math.max(0, Number(playCount) || 0) / 100_000;
}

export function pickWeightedIndex(weights, random = Math.random) {
  const list = Array.isArray(weights) ? weights : [];
  if (!list.length) return 0;
  const total = list.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  if (total <= 0) return Math.min(list.length - 1, Math.floor(random() * list.length));
  let ticket = random() * total;
  for (let index = 0; index < list.length; index += 1) {
    ticket -= Math.max(0, Number(list[index]) || 0);
    if (ticket <= 0) return index;
  }
  return list.length - 1;
}

export function planMixAudioOrder(files, { random = Math.random } = {}) {
  const remaining = (Array.isArray(files) ? files : []).filter(Boolean);
  const order = [];
  while (remaining.length) {
    const index = Math.min(remaining.length - 1, Math.floor(random() * remaining.length));
    order.push(remaining.splice(index, 1)[0]);
  }
  return order;
}

export function readAudioHitWeights(workDir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(workDir, "audio-hit-weights.json"), "utf8"));
    return normalizeWeightMap(value);
  } catch {
    return {};
  }
}

export function writeAudioHitWeights(workDir, weights) {
  const next = normalizeWeightMap(weights);
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, "audio-hit-weights.json"), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function refreshAudioHitWeights(workDir, fetchImpl = globalThis.fetch) {
  const existing = readAudioHitWeights(workDir);
  const settings = readWorkerSettings(workDir);
  if (!settings.url || !settings.token || typeof fetchImpl !== "function") return existing;
  try {
    const response = await fetchImpl(`${settings.url}/api/worker/audio-hit-weights`, {
      headers: { Authorization: `Bearer ${settings.token}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.weights || typeof data.weights !== "object" || Array.isArray(data.weights)) {
      return existing;
    }
    return writeAudioHitWeights(workDir, data.weights);
  } catch {
    return existing;
  }
}

function readWorkerSettings(workDir) {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(workDir, "factory-cloud-worker.json"), "utf8"));
  } catch {
    file = {};
  }
  return {
    url: String(process.env.FACTORY_CLOUD_URL || file.url || "").replace(/\/+$/, ""),
    token: String(process.env.FACTORY_WORKER_TOKEN || file.token || "").trim()
  };
}

function normalizeWeightMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next = {};
  for (const [key, playCount] of Object.entries(value)) {
    const name = path.basename(String(key || "")).trim().toLowerCase();
    const views = Math.max(0, Number(playCount) || 0);
    if (name) next[name] = Math.max(next[name] || 0, views);
  }
  return next;
}

