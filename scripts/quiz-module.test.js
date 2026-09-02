import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SIDEBAR_MODULES } from "./sidebar-modules.js";

const root = fileURLToPath(new URL("../", import.meta.url));

test("quiz module is wired through page, local server, cloud queue, and local worker", () => {
  const page = fs.readFileSync(path.join(root, "public", "quiz.html"), "utf8");
  const server = fs.readFileSync(path.join(root, "scripts", "server.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "scripts", "factory-cloud-worker.js"), "utf8");
  const cloudJobs = fs.readFileSync(path.join(root, "factory-cloud", "src", "jobs.js"), "utf8");
  const cloudPages = fs.readFileSync(path.join(root, "factory-cloud", "src", "pages.js"), "utf8");
  const composition = fs.readFileSync(path.join(root, "quiz-video-generator", "src", "QuizPaper.jsx"), "utf8");
  const client = fs.readFileSync(path.join(root, "public", "quiz.js"), "utf8");
  const renderJob = fs.readFileSync(path.join(root, "scripts", "quiz-render-job.js"), "utf8");
  assert.match(page, /<script src="\/quiz\.js"><\/script>/);
  assert.match(page, /href="\/quiz\.css"/);
  assert.match(server, /url\.pathname === "\/api\/quiz\/start"/);
  assert.match(server, /url\.pathname\.startsWith\("\/api\/quiz\/progress\/"\)/);
  assert.match(worker, /quiz: "quiz-render-job\.js"/);
  assert.match(cloudJobs, /\^\\\/api\\\/quiz\\\/start\$/);
  assert.match(cloudPages, /"\/quiz": "quiz\.html"/);
  assert.match(client, /\/api\/official-tiktok\/publish-accounts\?module=mid-video/);
  assert.match(client, /provider: "official"/);
  assert.match(client, /connectionIds/);
  assert.match(renderJob, /results: \[renderedArtifact\]/);
  assert.match(composition, /quiz-marker-scratch\.wav/);
  assert.match(composition, /quiz-countdown-tick\.wav/);
  assert.match(composition, /quiz-correct-chime\.wav/);
  assert.match(composition, /questionTitleFontSize/);
  assert.match(composition, /whiteSpace: "nowrap"/);
  assert.ok(fs.existsSync(path.join(root, "quiz-video-generator", "public", "quiz-marker-scratch.wav")));
  assert.ok(fs.existsSync(path.join(root, "quiz-video-generator", "public", "quiz-countdown-tick.wav")));
  assert.ok(fs.existsSync(path.join(root, "quiz-video-generator", "public", "quiz-correct-chime.wav")));
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "quiz")?.href, "/quiz");
});
