import assert from "node:assert/strict";
import test from "node:test";
import { normalizePathAliases, remapPath, remapPayloadPaths } from "./path-aliases.js";

const aliases = {
  "F:/音频目录": "//A/factory-audio",
  "F:\\视频素材\\": "\\\\A\\factory-videos",
  "F:/音频目录/特例": "//A/factory-special"
};
const never = { exists: () => false };

test("aliases are normalized and ordered longest-prefix first", () => {
  const list = normalizePathAliases(aliases);
  assert.deepEqual(list.map((item) => item.from), ["F:/音频目录/特例", "F:/音频目录", "F:/视频素材"]);
  assert.deepEqual(list.map((item) => item.to), ["\\\\A\\factory-special", "\\\\A\\factory-audio", "\\\\A\\factory-videos"]);
  assert.deepEqual(normalizePathAliases(undefined), []);
  assert.deepEqual(normalizePathAliases([]), []);
});

test("paths under an aliased prefix are rewritten, others untouched", () => {
  assert.equal(remapPath("F:\\音频目录\\0708", aliases, never), "\\\\A\\factory-audio\\0708");
  assert.equal(remapPath("f:/音频目录/NovelMaster/a b.mp3", aliases, never), "\\\\A\\factory-audio\\NovelMaster\\a b.mp3");
  assert.equal(remapPath("F:\\音频目录", aliases, never), "\\\\A\\factory-audio");
  assert.equal(remapPath("F:\\音频目录\\特例\\x", aliases, never), "\\\\A\\factory-special\\x");
  assert.equal(remapPath("F:\\音频目录2\\x", aliases, never), "F:\\音频目录2\\x");
  assert.equal(remapPath("G:\\别的\\x", aliases, never), "G:\\别的\\x");
  assert.equal(remapPath("", aliases, never), "");
});

test("a path that exists locally is left alone (primary machine)", () => {
  assert.equal(remapPath("F:\\音频目录\\0708", aliases, { exists: () => true }), "F:\\音频目录\\0708");
});

test("payload directory fields and audio items are remapped together", () => {
  const payload = {
    assetGroupId: "ASMR-Food4",
    videoDir: "F:\\视频素材\\ASMR Food4",
    audioDir: "F:\\音频目录\\0708",
    audioDirs: ["F:\\音频目录\\0708", "G:\\keep\\me"],
    backgroundMusicDir: "F:\\模板素材",
    dedup: { enabled: true, overlayDir: "F:\\视频素材\\overlay" },
    audioItems: [{ id: "a", targetAudioPath: "F:\\音频目录\\NovelMaster\\x.mp3", title: "t" }, null],
    totalVideos: 3
  };
  const out = remapPayloadPaths(payload, aliases, never);
  assert.equal(out.videoDir, "\\\\A\\factory-videos\\ASMR Food4");
  assert.equal(out.audioDir, "\\\\A\\factory-audio\\0708");
  assert.deepEqual(out.audioDirs, ["\\\\A\\factory-audio\\0708", "G:\\keep\\me"]);
  assert.equal(out.backgroundMusicDir, "F:\\模板素材");
  assert.equal(out.dedup.overlayDir, "\\\\A\\factory-videos\\overlay");
  assert.equal(out.audioItems[0].targetAudioPath, "\\\\A\\factory-audio\\NovelMaster\\x.mp3");
  assert.equal(out.audioItems[0].title, "t");
  assert.equal(out.audioItems[1], null);
  assert.equal(out.totalVideos, 3);
  assert.equal(payload.audioDir, "F:\\音频目录\\0708", "input is not mutated");
  assert.equal(remapPayloadPaths(payload, {}, never), payload, "no aliases → same object");
});
