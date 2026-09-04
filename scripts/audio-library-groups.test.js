import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverAudioLibraryGroups,
  findAudioInLibrary,
  normalizeAudioDirs,
  safePlatformFolderName
} from "./audio-library-groups.js";

test("discovers first-level date folders as batch groups", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-lib-"));
  fs.mkdirSync(path.join(root, "0810"));
  fs.writeFileSync(path.join(root, "0810", "a.mp3"), "x");
  fs.writeFileSync(path.join(root, "0810", "b.wav"), "x");
  fs.mkdirSync(path.join(root, "0708"));
  fs.writeFileSync(path.join(root, "0708", "c.mp3"), "x");
  const groups = discoverAudioLibraryGroups({ audioLibraryRoot: root });
  assert.deepEqual(
    groups.filter((item) => item.kind === "batch").map((item) => [item.name, item.totalAssets]),
    [["0708", 1], ["0810", 2]]
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("reads saved platform and promotion code from a legacy novel audio folder", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-meta-"));
  const folder = path.join(root, "Hidden Family");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "hook.mp3"), "x");
  fs.writeFileSync(path.join(folder, "novel.json"), JSON.stringify({
    platform: "NovelMaster",
    promotionCode: "454311"
  }));
  const groups = discoverAudioLibraryGroups({ audioLibraryRoot: root });
  const book = groups.find((item) => item.name === "Hidden Family");
  assert.equal(book.kind, "legacy");
  assert.equal(book.platform, "NovelMaster");
  assert.equal(book.promotionCode, "454311");
  assert.equal(groups.some((item) => item.kind === "legacy-bundle"), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("discovers platform folders and nested novel books", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-platform-"));
  const good = path.join(root, "GoodNovel", "The Housemaid");
  const moto = path.join(root, "MotoNovel", "Hidden Family");
  fs.mkdirSync(good, { recursive: true });
  fs.mkdirSync(moto, { recursive: true });
  fs.writeFileSync(path.join(good, "a.mp3"), "x");
  fs.writeFileSync(path.join(good, "novel.json"), JSON.stringify({
    platform: "GoodNovel",
    promotionCode: "GN-1"
  }));
  fs.writeFileSync(path.join(moto, "b.mp3"), "x");
  fs.mkdirSync(path.join(root, "0818"));
  fs.writeFileSync(path.join(root, "0818", "old.mp3"), "x");
  const groups = discoverAudioLibraryGroups({ audioLibraryRoot: root });
  const platforms = groups.filter((item) => item.kind === "platform");
  assert.deepEqual(platforms.map((item) => [item.name, item.bookCount, item.totalAssets]), [
    ["GoodNovel", 1, 1],
    ["MotoNovel", 1, 1]
  ]);
  const book = groups.find((item) => item.kind === "book" && item.name === "The Housemaid");
  assert.equal(book.platform, "GoodNovel");
  assert.equal(book.promotionCode, "GN-1");
  assert.equal(groups.some((item) => item.kind === "batch" && item.name === "0818"), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("maps known novel platforms to canonical folder names", () => {
  assert.equal(safePlatformFolderName("good novel"), "GoodNovel");
  assert.equal(safePlatformFolderName("MotoNovel"), "MotoNovel");
  assert.equal(safePlatformFolderName("Novel Master"), "NovelMaster");
  assert.equal(safePlatformFolderName(""), "未分平台");
});

test("finds novel audio by file name or id inside the fixed library", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-find-"));
  const file = path.join(root, "GoodNovel", "The Housemaid", "opening-audio-abc123456789.mp3");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
  assert.equal(findAudioInLibrary(["opening-audio-abc123456789.mp3"], { audioLibraryRoot: root }), file);
  assert.equal(findAudioInLibrary(["abc123456789"], { audioLibraryRoot: root }), file);
  fs.rmSync(root, { recursive: true, force: true });
});

test("normalizes mixed audioDirs values", () => {
  assert.deepEqual(
    normalizeAudioDirs("F:/音频目录/GoodNovel", ["F:\\音频目录\\GoodNovel", "F:/音频目录/MotoNovel", ""]),
    ["F:/音频目录/GoodNovel", "F:/音频目录/MotoNovel"]
  );
});
