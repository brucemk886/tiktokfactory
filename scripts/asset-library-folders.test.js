import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ASSET_ROOT_FOLDER,
  assetTopLevelFolder,
  discoverAssetLibraryGroups,
  filterAssetsByFolders,
  flattenAssetFolderNodes,
  normalizeAssetFolders,
  resolveAssetLibraryFile,
  summarizeAssetGroupFolders
} from "./asset-library.js";

test("reads the first-level folder under a material group", () => {
  assert.equal(assetTopLevelFolder("F:/视频素材/0904/minecraft/a.mp4", "F:/视频素材/0904"), "minecraft");
  assert.equal(assetTopLevelFolder("F:/视频素材/0904/a.mp4", "F:/视频素材/0904"), ASSET_ROOT_FOLDER);
});

test("normalizes asset folder names and drops blanks", () => {
  assert.deepEqual(normalizeAssetFolders(["minecraft", " minecraft ", "", "parkour"]), ["minecraft", "parkour"]);
  assert.deepEqual(normalizeAssetFolders(undefined), []);
});

test("builds a nested folder tree and skips review dumps", () => {
  const folders = summarizeAssetGroupFolders({
    sourceDir: "F:/视频素材/0904",
    assets: [
      { file: "F:/视频素材/0904/minecraft/town/a.mp4" },
      { file: "F:/视频素材/0904/minecraft/town/b.mp4" },
      { file: "F:/视频素材/0904/minecraft/c.mp4" },
      { file: "F:/视频素材/0904/parkour/d.mp4" },
      { file: "F:/视频素材/0904/_visual-review/skip.mp4" },
      { file: "F:/视频素材/0904/loose.mp4" }
    ]
  });
  assert.deepEqual(folders.map((item) => [item.name, item.path, item.totalAssets]), [
    ["minecraft", "minecraft", 3],
    ["parkour", "parkour", 1],
    [ASSET_ROOT_FOLDER, ASSET_ROOT_FOLDER, 1]
  ]);
  const minecraft = folders.find((item) => item.path === "minecraft");
  assert.deepEqual(minecraft.children.map((item) => [item.path, item.totalAssets]), [["minecraft/town", 2]]);
  assert.equal(flattenAssetFolderNodes(folders).some((item) => item.path.includes("_visual-review")), false);
});

test("falls back to the disk tree when a group has not been indexed yet", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-folders-"));
  fs.mkdirSync(path.join(root, "minecraft", "town"), { recursive: true });
  fs.mkdirSync(path.join(root, "parkour"));
  fs.mkdirSync(path.join(root, "_failed-review"));
  fs.writeFileSync(path.join(root, "minecraft", "town", "a.mp4"), "x");
  fs.writeFileSync(path.join(root, "parkour", "b.mp4"), "x");
  fs.writeFileSync(path.join(root, "_failed-review", "c.mp4"), "x");
  const folders = summarizeAssetGroupFolders({ sourceDir: root, assets: [] });
  assert.deepEqual(folders.map((item) => item.name), ["minecraft", "parkour"]);
  assert.deepEqual(folders[0].children.map((item) => item.name), ["town"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("does not register hidden downloader folders as material groups", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "asset-discover-"));
  const library = path.join(repo, "videos");
  const workDir = path.join(repo, "work");
  fs.mkdirSync(path.join(library, "0904"), { recursive: true });
  fs.mkdirSync(path.join(library, ".meowload"), { recursive: true });
  fs.mkdirSync(path.join(library, "_tmp"), { recursive: true });
  fs.writeFileSync(path.join(repo, "config.json"), JSON.stringify({ workDir }));
  const groups = discoverAssetLibraryGroups(repo, library);
  assert.deepEqual(groups.map((item) => item.name), ["0904"]);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("filters mix assets by a nested folder without taking its siblings", () => {
  const assets = [
    { id: "town", file: "F:/视频素材/0904/minecraft/town/a.mp4" },
    { id: "root", file: "F:/视频素材/0904/minecraft/b.mp4" },
    { id: "parkour", file: "F:/视频素材/0904/parkour/c.mp4" }
  ];
  assert.deepEqual(
    filterAssetsByFolders(assets, "F:/视频素材/0904", ["minecraft/town"]).map((item) => item.id),
    ["town"]
  );
  assert.deepEqual(
    filterAssetsByFolders(assets, "F:/视频素材/0904", ["minecraft"]).map((item) => item.id),
    ["town", "root"]
  );
});

test("resolves a preview file only inside the material group", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-preview-"));
  const file = path.join(root, "2", "clip.mp4");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
  assert.equal(resolveAssetLibraryFile({ sourceDir: root }, "2/clip.mp4"), path.resolve(file));
  assert.throws(() => resolveAssetLibraryFile({ sourceDir: root }, "../secret.mp4"));
  fs.rmSync(root, { recursive: true, force: true });
});
