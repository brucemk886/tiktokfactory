import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSeed, listSeedSettingsFiles } from "./export-seed.mjs";
import { applySeed, buildWorkerConfig, buildWorkerSettings, parseArgs, SECONDARY_RENDER_JOB_TYPES } from "./apply-seed.mjs";

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("seed carries shared config, factory token and *-settings files but not machine paths", () => {
  const workDir = tmp("seed-work-");
  fs.writeFileSync(path.join(workDir, "official-tiktok-analytics-settings.json"), JSON.stringify({ apiKey: "k" }));
  fs.writeFileSync(path.join(workDir, "reddit-mix-settings.json"), JSON.stringify({ a: 1 }));
  fs.writeFileSync(path.join(workDir, "publish-records.json"), "[]");
  fs.writeFileSync(path.join(workDir, "broken-settings.json"), "{not json");
  assert.deepEqual(listSeedSettingsFiles(workDir), ["broken-settings.json", "official-tiktok-analytics-settings.json", "reddit-mix-settings.json"]);
  const seed = buildSeed({
    config: { fps: 30, elevenLabsApiKey: "e", workDir: "D:/x/work", outputDir: "D:/x/out", assetLibraryRoot: "F:/v", audioLibraryRoot: "F:/a" },
    workDir,
    workerSettings: { url: "https://factory.example.com/", token: "t", workerId: "windows-local" }
  });
  assert.deepEqual(seed.config, { fps: 30, elevenLabsApiKey: "e" });
  assert.deepEqual(seed.factoryCloud, { url: "https://factory.example.com/", token: "t" });
  assert.deepEqual(Object.keys(seed.files), ["official-tiktok-analytics-settings.json", "reddit-mix-settings.json"]);
});

test("worker config and settings are derived from the seed plus this machine's paths", () => {
  const seed = { config: { fps: 30 }, factoryCloud: { url: "https://factory.example.com/", token: "t" } };
  const config = buildWorkerConfig(seed, { dataDir: "E:\\data\\", assetLibraryRoot: "E:\\视频素材", audioLibraryRoot: "E:/音频目录/" });
  assert.deepEqual(config, { fps: 30, workDir: "E:/data/work", outputDir: "E:/data/outputs", assetLibraryRoot: "E:/视频素材", audioLibraryRoot: "E:/音频目录" });
  const settings = buildWorkerSettings(seed, { workerId: "worker-2", label: "老家", renderConcurrency: "3" });
  assert.equal(settings.url, "https://factory.example.com");
  assert.equal(settings.workerId, "worker-2");
  assert.equal(settings.assignedOnly, true);
  assert.equal(settings.renderConcurrency, 3);
  assert.deepEqual(settings.renderJobTypes, SECONDARY_RENDER_JOB_TYPES);
  assert.throws(() => buildWorkerSettings(seed, { workerId: "windows-local" }), /主机/);
  assert.throws(() => buildWorkerSettings(seed, { workerId: "" }), /worker-id/);
});

test("applySeed writes config.json, factory-cloud-worker.json and settings files", () => {
  const root = tmp("seed-root-");
  const data = tmp("seed-data-");
  const assets = tmp("seed-assets-");
  const audio = tmp("seed-audio-");
  const seedPath = path.join(root, "seed.json");
  fs.writeFileSync(seedPath, JSON.stringify({
    config: { fps: 30 },
    factoryCloud: { url: "https://factory.example.com", token: "t" },
    files: { "reddit-mix-settings.json": { a: 1 }, "../evil.json": {} }
  }));
  const result = applySeed({ root, seedPath, workerId: "worker-2", assetLibraryRoot: assets, audioLibraryRoot: audio, dataDir: data });
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  assert.equal(config.workDir, `${data.replace(/\\/g, "/")}/work`);
  assert.equal(config.assetLibraryRoot, assets.replace(/\\/g, "/"));
  const settings = JSON.parse(fs.readFileSync(path.join(config.workDir, "factory-cloud-worker.json"), "utf8"));
  assert.equal(settings.workerId, "worker-2");
  assert.equal(settings.assignedOnly, true);
  assert.deepEqual(result.files, ["reddit-mix-settings.json"]);
  assert.ok(fs.existsSync(path.join(config.workDir, "reddit-mix-settings.json")));
  assert.ok(fs.existsSync(config.outputDir));
  assert.throws(() => applySeed({ root, seedPath, workerId: "worker-2", assetLibraryRoot: path.join(assets, "missing"), audioLibraryRoot: audio, dataDir: data }), /不存在/);
});

test("parseArgs reads --kebab-case flags", () => {
  assert.deepEqual(parseArgs(["--seed", "s.json", "--worker-id", "w2", "--skip-index", "--asset-root", "E:\\v"]), {
    seed: "s.json",
    workerId: "w2",
    skipIndex: true,
    assetRoot: "E:\\v"
  });
});
