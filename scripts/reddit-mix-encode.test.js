import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const mixJob = fs.readFileSync(fileURLToPath(new URL("./reddit-mix-job.js", import.meta.url)), "utf8");

test("final mux keeps 1080p quality while capping bitrate for smaller files", () => {
  assert.match(mixJob, /const quality = payload\.quality \|\| "fast"/);
  assert.match(mixJob, /preset: "fast", crf: "22", maxrate: "2.5M", bufsize: "5M", audio: "128k"/);
  assert.match(mixJob, /preset: "medium", crf: "20", maxrate: "3.5M", bufsize: "7M", audio: "160k"/);
  assert.doesNotMatch(mixJob, /finalVideoEncodeArgs[\s\S]*"-b:v", encode\.maxrate/);
  assert.match(mixJob, /"-maxrate", encode\.maxrate/);
  assert.match(mixJob, /h264_nvenc/);
  assert.match(mixJob, /"-pix_fmt", "yuv420p"/);
  assert.match(mixJob, /"-profile:v", "high"/);
  assert.doesNotMatch(mixJob, /muxAudioAndCaptions[\s\S]*-preset", "veryfast"/);
  assert.match(mixJob, /endCardEnabled === false/);
  assert.match(mixJob, /resolveNovelEndCard/);
  assert.match(mixJob, /normalizeAudioDirs/);
  assert.match(mixJob, /renderNovelAppIcon/);
});

test("clip rendering fans out a few ffmpeg encodes instead of one-by-one", () => {
  assert.match(mixJob, /await renderClips\(/);
  assert.match(mixJob, /function clipRenderConcurrency/);
  assert.match(mixJob, /hasNvencEncoder\(\) \? 3 : 2/);
  assert.match(mixJob, /await mapLimit\(clips, clipRenderConcurrency\(\)/);
  assert.match(mixJob, /function runAsync/);
  assert.match(mixJob, /await runAsync\("ffmpeg"/);
  assert.match(mixJob, /payload\.onePass !== false/);
  assert.match(mixJob, /去重只保留缩放、镜像和变速/);
  assert.doesNotMatch(mixJob, /unsharp=5:5/);
  assert.doesNotMatch(mixJob, /filters\.push\(`rotate=/);
});
