import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverAudioLibraryGroups, findAudioInLibrary } from "./audio-library-groups.js";

test("discovers first-level audio folders and counts files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-lib-"));
  fs.mkdirSync(path.join(root, "0810"));
  fs.writeFileSync(path.join(root, "0810", "a.mp3"), "x");
  fs.writeFileSync(path.join(root, "0810", "b.wav"), "x");
  fs.mkdirSync(path.join(root, "0708"));
  fs.writeFileSync(path.join(root, "0708", "c.mp3"), "x");
  const groups = discoverAudioLibraryGroups({ audioLibraryRoot: root });
  assert.deepEqual(groups.map((item) => [item.name, item.totalAssets]), [["0708", 1], ["0810", 2]]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("finds novel audio by file name or id inside the fixed library", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-find-"));
  const file = path.join(root, "0810", "opening-audio-abc123456789.mp3");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
  assert.equal(findAudioInLibrary(["opening-audio-abc123456789.mp3"], { audioLibraryRoot: root }), file);
  assert.equal(findAudioInLibrary(["abc123456789"], { audioLibraryRoot: root }), file);
  fs.rmSync(root, { recursive: true, force: true });
});
