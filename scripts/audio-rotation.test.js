import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AUDIO_ROTATION_FILE, audioRotationKey, reserveAudioRotation } from "./audio-rotation.js";

function tempWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audio-rotation-"));
}

test("rotation key ignores slash style, case and order of folders", () => {
  const a = audioRotationKey(["F:\\音频\\GoodNovel\\", "F:/音频/NovelMaster"]);
  const b = audioRotationKey(["f:/音频/novelmaster", "F:/音频/GoodNovel"]);
  assert.equal(a, b);
  assert.notEqual(a, audioRotationKey(["F:/音频/GoodNovel"]));
  assert.equal(audioRotationKey([]), "");
});

test("consecutive tasks walk through the folder instead of restarting at zero", () => {
  const workDir = tempWorkDir();
  const dirs = ["F:/音频/GoodNovel"];
  const first = reserveAudioRotation({ workDir, dirs, audioCount: 91, count: 32 });
  const second = reserveAudioRotation({ workDir, dirs, audioCount: 91, count: 32 });
  const third = reserveAudioRotation({ workDir, dirs, audioCount: 91, count: 32 });
  const fourth = reserveAudioRotation({ workDir, dirs, audioCount: 91, count: 32 });
  assert.deepEqual([first.offset, second.offset, third.offset, fourth.offset], [0, 32, 64, 5]);
  assert.ok(first.reserved);
  const state = JSON.parse(fs.readFileSync(path.join(workDir, AUDIO_ROTATION_FILE), "utf8"));
  assert.equal(state[first.key].cursor, 37);
  assert.equal(state[first.key].lastOffset, 5);
});

test("adding audio files keeps the cursor instead of resetting the walk", () => {
  const workDir = tempWorkDir();
  const dirs = ["F:/音频/GoodNovel"];
  reserveAudioRotation({ workDir, dirs, audioCount: 10, count: 8 });
  const next = reserveAudioRotation({ workDir, dirs, audioCount: 14, count: 8 });
  assert.equal(next.offset, 8);
});

test("different folder selections keep independent cursors", () => {
  const workDir = tempWorkDir();
  reserveAudioRotation({ workDir, dirs: ["F:/a"], audioCount: 10, count: 4 });
  const other = reserveAudioRotation({ workDir, dirs: ["F:/b"], audioCount: 10, count: 4 });
  const same = reserveAudioRotation({ workDir, dirs: ["F:/a"], audioCount: 10, count: 4 });
  assert.equal(other.offset, 0);
  assert.equal(same.offset, 4);
});

test("nothing is reserved without a work dir, folders or audio", () => {
  const workDir = tempWorkDir();
  assert.equal(reserveAudioRotation({ workDir: "", dirs: ["F:/a"], audioCount: 3, count: 1 }).reserved, false);
  assert.equal(reserveAudioRotation({ workDir, dirs: [], audioCount: 3, count: 1 }).reserved, false);
  assert.equal(reserveAudioRotation({ workDir, dirs: ["F:/a"], audioCount: 0, count: 1 }).reserved, false);
  assert.equal(fs.existsSync(path.join(workDir, AUDIO_ROTATION_FILE)), false);
});
