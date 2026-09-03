import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applySeed, buildWorkerConfig, buildWorkerSettings, parseArgs, rewriteAssetPaths, uncRoot } from "./apply-seed.mjs";

test("asset index paths are rewritten from the primary drive to the UNC share", () => {
  const groups = {
    groups: [{
      id: "asmr-food",
      sourceDir: "F:\\视频素材\\ASMR Food",
      path: "F:/视频素材/ASMR Food",
      assets: [{ id: "a1", file: "F:\\视频素材\\ASMR Food\\clip 1.mp4", duration: 12 }],
      note: "F:\\其他目录\\不改"
    }]
  };
  const out = rewriteAssetPaths(groups, "F:/视频素材", "//A/factory-videos");
  const group = out.groups[0];
  assert.equal(group.sourceDir, "\\\\A\\factory-videos\\ASMR Food");
  assert.equal(group.path, "\\\\A\\factory-videos\\ASMR Food");
  assert.equal(group.assets[0].file, "\\\\A\\factory-videos\\ASMR Food\\clip 1.mp4");
  assert.equal(group.assets[0].duration, 12);
  assert.equal(group.note, "F:\\其他目录\\不改");
  assert.equal(rewriteAssetPaths("F:\\视频素材", "F:/视频素材/", "//A/factory-videos"), "\\\\A\\factory-videos");
  assert.equal(rewriteAssetPaths("F:\\视频素材2\\x.mp4", "F:/视频素材", "//A/factory-videos"), "F:\\视频素材2\\x.mp4");
});

test("worker config keeps secrets but points at local data and the shares", () => {
  const config = buildWorkerConfig(
    { elevenLabsApiKey: "k", workDir: "D:/localfactory-data/work", assetLibraryRoot: "F:/视频素材", audioLibraryRoot: "F:/音频目录" },
    { dataDir: "E:\\factory", assetLibraryRoot: uncRoot("A", "factory-videos"), audioLibraryRoot: uncRoot("A", "factory-audio") }
  );
  assert.equal(config.elevenLabsApiKey, "k");
  assert.equal(config.workDir, "E:/factory/work");
  assert.equal(config.outputDir, "E:/factory/outputs");
  assert.equal(config.assetLibraryRoot, "//A/factory-videos");
  assert.equal(config.audioLibraryRoot, "//A/factory-audio");
  assert.deepEqual(config.pathAliases, { "F:/视频素材": "//A/factory-videos", "F:/音频目录": "//A/factory-audio" });
});

test("worker settings get a distinct id and a render whitelist", () => {
  const seed = { url: "https://factory.example.com/", token: "t", workerId: "windows-local", pollMs: 60000, syncMs: 300000 };
  const settings = buildWorkerSettings(seed, { workerId: "windows-2", renderTypes: "auto-task, reddit-mix,", renderConcurrency: 3 });
  assert.deepEqual(settings, {
    url: "https://factory.example.com/",
    token: "t",
    workerId: "windows-2",
    pollMs: 60000,
    syncMs: 300000,
    renderConcurrency: 3,
    publishConcurrency: 1,
    renderJobTypes: ["auto-task", "reddit-mix"]
  });
  assert.throws(() => buildWorkerSettings(seed, { workerId: "windows-local" }), /必须不同/);
  assert.throws(() => buildWorkerSettings({ url: "x" }, { workerId: "windows-2" }), /token/);
});

test("applySeed writes config, index, settings and copies caches from a seed folder", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "factory-seed-"));
  const seedDir = path.join(base, "seed");
  const root = path.join(base, "repo");
  const dataDir = path.join(base, "data");
  fs.mkdirSync(path.join(seedDir, "asset-library"), { recursive: true });
  fs.mkdirSync(path.join(seedDir, "caption-cache"), { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(seedDir, "seed.json"), JSON.stringify({
    primaryHost: "A", assetLibraryRoot: "F:/视频素材", audioLibraryRoot: "F:/音频目录", videosShare: "factory-videos", audioShare: "factory-audio"
  }));
  fs.writeFileSync(path.join(seedDir, "config.json"), JSON.stringify({ kieApiKey: "k", assetLibraryRoot: "F:/视频素材" }));
  fs.writeFileSync(path.join(seedDir, "asset-library", "groups.json"), JSON.stringify({
    groups: [{ id: "g", sourceDir: "F:\\视频素材\\g", assets: [{ id: "x", file: "F:\\视频素材\\g\\x.mp4" }] }]
  }));
  fs.writeFileSync(path.join(seedDir, "caption-cache", "abc.json"), "{}");
  fs.writeFileSync(path.join(seedDir, "official-tiktok-analytics-settings.json"), JSON.stringify({ apiKey: "d" }));
  fs.writeFileSync(path.join(seedDir, "factory-cloud-worker.json"), JSON.stringify({ url: "https://f", token: "t", workerId: "windows-local" }));

  const logs = [];
  const result = applySeed({ seedDir, root, dataDir, workerId: "windows-2", log: (line) => logs.push(line) });
  assert.equal(result.assetLibraryRoot, "//A/factory-videos");
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  assert.equal(config.kieApiKey, "k");
  assert.equal(config.workDir, `${dataDir.replace(/\\/g, "/")}/work`);
  const groups = JSON.parse(fs.readFileSync(path.join(dataDir, "work", "asset-library", "groups.json"), "utf8"));
  assert.equal(groups.groups[0].assets[0].file, "\\\\A\\factory-videos\\g\\x.mp4");
  assert.ok(fs.existsSync(path.join(dataDir, "work", "asset-library", "usage.json")));
  assert.ok(fs.existsSync(path.join(dataDir, "work", "caption-cache", "abc.json")));
  assert.ok(fs.existsSync(path.join(dataDir, "work", "official-tiktok-analytics-settings.json")));
  assert.ok(fs.existsSync(path.join(dataDir, "outputs")));
  const settings = JSON.parse(fs.readFileSync(path.join(dataDir, "work", "factory-cloud-worker.json"), "utf8"));
  assert.equal(settings.workerId, "windows-2");
  assert.deepEqual(settings.renderJobTypes, ["auto-task", "reddit-mix"]);

  // Second run without --force keeps what is there.
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ edited: true }));
  applySeed({ seedDir, root, dataDir, workerId: "windows-2", log: () => {} });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")), { edited: true });
});

test("cli args parse flags and values", () => {
  assert.deepEqual(parseArgs(["--seed", "\\\\A\\factory-seed", "--force", "--worker-id", "windows-2"]), {
    seed: "\\\\A\\factory-seed",
    force: true,
    "worker-id": "windows-2"
  });
});
