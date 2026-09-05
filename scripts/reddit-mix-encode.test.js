import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const mixJob = fs.readFileSync(fileURLToPath(new URL("./reddit-mix-job.js", import.meta.url)), "utf8");

test("final mux locks video bitrate at 2000k", () => {
  assert.match(mixJob, /const quality = payload\.quality \|\| "fast"/);
  assert.match(mixJob, /bitrate: "2000k"/);
  assert.match(mixJob, /maxrate: "2000k"/);
  assert.match(mixJob, /bufsize: "4000k"/);
  assert.match(mixJob, /"-rc", "cbr"/);
  assert.match(mixJob, /"-b:v", encode\.bitrate/);
  assert.match(mixJob, /h264_nvenc/);
  assert.match(mixJob, /makeWordPopSubtitles/);
  assert.match(mixJob, /word-pop/);
  assert.match(mixJob, /"-pix_fmt", "yuv420p"/);
  assert.match(mixJob, /"-profile:v", "high"/);
  assert.doesNotMatch(mixJob, /maxrate: "2\.5M"/);
  assert.doesNotMatch(mixJob, /maxrate: "3\.5M"/);
  assert.doesNotMatch(mixJob, /bitrate: "3600k"/);
  assert.doesNotMatch(mixJob, /muxAudioAndCaptions[\s\S]*-preset", "veryfast"/);
  assert.match(mixJob, /endCardEnabled === false/);
  assert.match(mixJob, /resolveNovelEndCard/);
  assert.match(mixJob, /normalizeAudioDirs/);
  assert.match(mixJob, /renderNovelAppIcon/);
  assert.match(mixJob, /renderRedditHookCard/);
  assert.match(mixJob, /hook-card.png/);
  assert.match(mixJob, /platform: novelBadge\?\.platform \|\| endCard\?\.platform \|\| audioFallback\.platform/);
  assert.match(mixJob, /promotionCode: novelBadge\?\.promotionCode \|\| endCard\?\.promotionCode \|\| audioFallback\.promotionCode/);
  assert.match(mixJob, /hideCaptionsUntil\(visibleCaptions, hookCardUntil\)/);
  assert.match(mixJob, /hookCardY = "\(H-h\)\/2"/);
  assert.match(mixJob, /overlay=x=\(W-w\)\/2:y=\$\{y\}:enable='lt\(t,\$\{until\}\)\'/);
  assert.doesNotMatch(mixJob, /\* 0\.13/);
  assert.match(mixJob, /planMixAudioOrder/);
  assert.doesNotMatch(mixJob, /refreshAudioHitWeights/);
});

test("mix always one-passes and skips on failure", () => {
  assert.match(mixJob, /renderMixOnePass\(/);
  assert.match(mixJob, /encodeMode = isParkourVideoTemplate\(payload\) \? "parkour" : "one-pass"/);
  assert.match(mixJob, /合成失败，已跳过/);
  assert.doesNotMatch(mixJob, /payload\.onePass !== false/);
  assert.doesNotMatch(mixJob, /改回分段编码/);
  assert.doesNotMatch(mixJob, /legacy-fallback/);
  assert.match(mixJob, /去重只保留缩放、镜像和变速/);
  assert.doesNotMatch(mixJob, /unsharp=5:5/);
  assert.doesNotMatch(mixJob, /filters\.push\(`rotate=/);
});
