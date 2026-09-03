import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bootstrapWorker, buildWorkerConfig, buildWorkerSettings, fetchBootstrap, parseArgs, SECONDARY_RENDER_JOB_TYPES } from "./bootstrap-worker.mjs";

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const fakeFetch = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });

test("worker config starts from config.example.json plus this machine's paths and keys", () => {
  const example = { fps: 30, fontFile: "", elevenLabsApiKey: "", workDir: "x", outputDir: "y", assetLibraryRoot: "z", audioLibraryRoot: "w" };
  const config = buildWorkerConfig(example, { dataDir: "E:\\data\\", assetLibraryRoot: "E:\\视频素材", audioLibraryRoot: "E:/音频目录/", elevenLabsApiKey: "el", fontFile: "C:/Windows/Fonts/msyh.ttc" });
  assert.deepEqual(config, {
    fps: 30,
    fontFile: "C:/Windows/Fonts/msyh.ttc",
    elevenLabsApiKey: "el",
    workDir: "E:/data/work",
    outputDir: "E:/data/outputs",
    assetLibraryRoot: "E:/视频素材",
    audioLibraryRoot: "E:/音频目录"
  });
});

test("worker settings pin the machine to assigned tasks only", () => {
  const settings = buildWorkerSettings({ factoryUrl: "https://factory.example.com/", token: " t ", workerId: "worker-2", label: "老家", renderConcurrency: "3" });
  assert.equal(settings.url, "https://factory.example.com");
  assert.equal(settings.token, "t");
  assert.equal(settings.workerId, "worker-2");
  assert.equal(settings.assignedOnly, true);
  assert.equal(settings.renderConcurrency, 3);
  assert.deepEqual(settings.renderJobTypes, SECONDARY_RENDER_JOB_TYPES);
  assert.throws(() => buildWorkerSettings({ token: "t", workerId: "windows-local" }), /另一台/);
  assert.throws(() => buildWorkerSettings({ token: "t", workerId: "" }), /worker-id/);
  assert.throws(() => buildWorkerSettings({ token: "", workerId: "w2" }), /token/);
});

test("fetchBootstrap explains a wrong token", async () => {
  await assert.rejects(fetchBootstrap({ factoryUrl: "https://f", token: "x", fetchImpl: fakeFetch({}, 401) }), /401/);
  const data = await fetchBootstrap({ factoryUrl: "https://f/", token: "x", fetchImpl: fakeFetch({ elevenLabsApiKey: "k" }) });
  assert.equal(data.elevenLabsApiKey, "k");
});

test("bootstrapWorker writes config.json, worker settings and desk credentials from the cloud", async () => {
  const root = tmp("boot-root-");
  const data = tmp("boot-data-");
  const assets = tmp("boot-assets-");
  const audio = tmp("boot-audio-");
  fs.writeFileSync(path.join(root, "config.example.json"), JSON.stringify({ fps: 30, elevenLabsApiKey: "", fontFile: "" }));
  const remote = { signalDesk: { baseUrl: "https://desk.example.com/", apiKey: "desk" }, elevenLabsApiKey: "el", redditMixSettings: { a: 1 } };
  const result = await bootstrapWorker({
    root, token: "t", workerId: "worker-2", assetLibraryRoot: assets, audioLibraryRoot: audio, dataDir: data,
    factoryUrl: "https://factory.example.com", fetchImpl: fakeFetch(remote), fontFile: ""
  });
  assert.deepEqual(result.warnings, []);
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  assert.equal(config.elevenLabsApiKey, "el");
  assert.equal(config.workDir, `${data.replace(/\\/g, "/")}/work`);
  assert.equal(config.assetLibraryRoot, assets.replace(/\\/g, "/"));
  const settings = JSON.parse(fs.readFileSync(path.join(config.workDir, "factory-cloud-worker.json"), "utf8"));
  assert.equal(settings.workerId, "worker-2");
  assert.equal(settings.assignedOnly, true);
  const desk = JSON.parse(fs.readFileSync(path.join(config.workDir, "official-tiktok-analytics-settings.json"), "utf8"));
  assert.equal(desk.baseUrl, "https://desk.example.com");
  assert.equal(desk.apiKey, "desk");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(config.workDir, "reddit-mix-settings.json"), "utf8")), { a: 1 });
  assert.ok(fs.existsSync(config.outputDir));

  // Explicit flags win over the cloud; missing keys only warn.
  const second = await bootstrapWorker({
    root, token: "t", workerId: "worker-3", assetLibraryRoot: assets, audioLibraryRoot: audio, dataDir: data,
    fetchImpl: fakeFetch({ signalDesk: { baseUrl: "", apiKey: "" }, elevenLabsApiKey: "" }), elevenLabsApiKey: "mine", fontFile: ""
  });
  assert.equal(second.hasElevenLabsKey, true);
  assert.equal(second.desk.hasApiKey, false);
  assert.equal(second.warnings.length, 1);
  assert.match(second.warnings[0], /中台/);

  await assert.rejects(bootstrapWorker({
    root, token: "t", workerId: "worker-2", assetLibraryRoot: path.join(assets, "missing"), audioLibraryRoot: audio, dataDir: data, fetchImpl: fakeFetch(remote)
  }), /不存在/);
});

test("parseArgs reads --kebab-case flags", () => {
  assert.deepEqual(parseArgs(["--token", "t", "--worker-id", "w2", "--skip-index", "--asset-root", "E:\\v"]), {
    token: "t",
    workerId: "w2",
    skipIndex: true,
    assetRoot: "E:\\v"
  });
});
