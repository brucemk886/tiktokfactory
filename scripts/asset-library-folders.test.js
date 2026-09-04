import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ASSET_ROOT_FOLDER,
  assetTopLevelFolder,
  filterAssetsByFolders,
  normalizeAssetFolders,
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

test("summarizes grouped subfolders from indexed assets and skips review dumps", () => {
  const folders = summarizeAssetGroupFolders({
    sourceDir: "F:/视频素材/0904",
    assets: [
      { file: "F:/视频素材/0904/minecraft/a.mp4" },
      { file: "F:/视频素材/0904/minecraft/b.mp4" },
      { file: "F:/视频素材/0904/parkour/c.mp4" },
      { file: "F:/视频素材/0904/_visual-review/skip.mp4" },
      { file: "F:/视频素材/0904/loose.mp4" }
    ]
  });
  assert.deepEqual(folders, [
    { name: "minecraft", totalAssets: 2 },
    { name: "parkour", totalAssets: 1 },
    { name: ASSET_ROOT_FOLDER, totalAssets: 1 }
  ]);
});

test("falls back to the disk tree when a group has not been indexed yet", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-folders-"));
  fs.mkdirSync(path.join(root, "minecraft"));
  fs.mkdirSync(path.join(root, "parkour"));
  fs.mkdirSync(path.join(root, "_failed-review"));
  fs.writeFileSync(path.join(root, "minecraft", "a.mp4"), "x");
  fs.writeFileSync(path.join(root, "parkour", "b.mp4"), "x");
  fs.writeFileSync(path.join(root, "_failed-review", "c.mp4"), "x");
  const folders = summarizeAssetGroupFolders({ sourceDir: root, assets: [] });
  assert.deepEqual(folders.map((item) => item.name), ["minecraft", "parkour"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("filters mix assets to the checked subfolders only", () => {
  const assets = [
    { id: "m", file: "F:/视频素材/0904/minecraft/a.mp4" },
    { id: "p", file: "F:/视频素材/0904/parkour/b.mp4" },
    { id: "r", file: "F:/视频素材/0904/loose.mp4" }
  ];
  assert.deepEqual(
    filterAssetsByFolders(assets, "F:/视频素材/0904", ["minecraft"]).map((item) => item.id),
    ["m"]
  );
  assert.deepEqual(
    filterAssetsByFolders(assets, "F:/视频素材/0904", []).map((item) => item.id),
    ["m", "p", "r"]
  );
});
