import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const mixJob = fs.readFileSync(fileURLToPath(new URL("./reddit-mix-job.js", import.meta.url)), "utf8");

test("final mux keeps 1080p quality while capping bitrate for smaller files", () => {
  assert.match(mixJob, /quality: payload\.quality \|\| "fast"/);
  assert.match(mixJob, /preset: "fast", crf: "22", maxrate: "4M", bufsize: "8M", audio: "128k"/);
  assert.match(mixJob, /preset: "medium", crf: "20", maxrate: "5M", bufsize: "10M", audio: "160k"/);
  assert.match(mixJob, /"-maxrate", encode\.maxrate/);
  assert.match(mixJob, /"-pix_fmt", "yuv420p"/);
  assert.match(mixJob, /"-profile:v", "high"/);
  assert.doesNotMatch(mixJob, /muxAudioAndCaptions[\s\S]*-preset", "veryfast"/);
  assert.match(mixJob, /endCardEnabled === false/);
  assert.match(mixJob, /resolveNovelEndCard/);
  assert.match(mixJob, /normalizeAudioDirs/);
  assert.match(mixJob, /renderNovelAppIcon/);
});
