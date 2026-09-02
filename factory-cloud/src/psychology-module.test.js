import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { publicPsychologySettings } from "./compat.js";
import { persistableJobResult, publicJob } from "./jobs.js";
import { pageFileFor } from "./pages.js";
import { SIDEBAR_MODULES, moduleIdForPath } from "./sidebar.js";

test("psychology target pages are routed and protected by one admin sidebar module", () => {
  assert.equal(pageFileFor("/psychology-collage"), "psychology-collage.html");
  assert.equal(pageFileFor("/psychology-target-2"), "psychology-narrative.html");
  assert.equal(pageFileFor("/psychology-narrative"), "psychology-narrative.html");
  assert.equal(moduleIdForPath("/psychology-collage"), "psychology-narrative");
  assert.equal(moduleIdForPath("/psychology-target-2"), "psychology-narrative");
  const module = SIDEBAR_MODULES.find((item) => item.id === "psychology-narrative");
  assert.equal(module?.href, "/psychology-target-2");
  assert.equal(module?.group?.id, "mid-video");
  assert.deepEqual(module?.roles, ["admin"]);
});

test("psychology settings expose readiness without returning API keys", () => {
  const settings = publicPsychologySettings({
    kieApiKey: "kie-secret",
    elevenLabsApiKey: "eleven-secret",
    elevenLabsVoiceId: "voice-1",
    elevenLabsModelId: "eleven_multilingual_v2",
  });
  assert.equal(settings.configured, true);
  assert.equal(settings.kieConfigured, true);
  assert.equal(settings.elevenLabsConfigured, true);
  assert.equal(settings.elevenLabsVoiceId, "voice-1");
  assert.equal("kieApiKey" in settings, false);
  assert.equal("elevenLabsApiKey" in settings, false);
});

test("cloud queue and local worker dispatch both psychology target types", () => {
  const jobs = fs.readFileSync(new URL("./jobs.js", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../../scripts/factory-cloud-worker.js", import.meta.url), "utf8");
  const auth = fs.readFileSync(new URL("./auth.js", import.meta.url), "utf8");
  assert.match(jobs, /\/api\\\/psychology-collage\\\/start/);
  assert.match(jobs, /\/api\\\/psychology-narrative\\\/start/);
  assert.match(jobs, /type: "psychology-collage"/);
  assert.match(jobs, /type: "psychology-target-2"/);
  assert.match(worker, /"psychology-collage": "psychology-collage-job\.js"/);
  assert.match(worker, /"psychology-target-2": "psychology-narrative-job\.js"/);
  assert.match(auth, /insertModuleAfter\(modules, "schulte", "psychology-narrative"\)/);
});

test("psychology result metadata remains available to the existing progress pages", () => {
  const stored = persistableJobResult({
    score: { score: 96, passed: true },
    plan: { title: "Choose the position that feels safest" },
    captionTimings: [{ zh: "Choose one.", en: "", start: 0, end: 1.2 }],
    results: [{
      fileName: "psychology.mp4",
      videoUrl: "/outputs/psychology.mp4",
      contactSheetFileName: "psychology.jpg",
      contactSheetUrl: "/outputs/psychology.jpg",
      title: "Choose the position that feels safest",
      template: "psychology-target-2",
      templateLabel: "心理学 · 目标2",
      quizType: "position-choice",
      language: "en",
      ttsProvider: "kokoro",
      duration: 15.1,
      score: 96,
    }],
  });
  const job = publicJob({
    id: "psychology-target-2-1",
    type: "psychology-target-2",
    status: "done",
    percent: 100,
    message: "done",
    error: "",
    result_json: JSON.stringify(stored),
    created_at: 1,
    updated_at: 2,
  });
  assert.equal(job.results[0].title, "Choose the position that feels safest");
  assert.equal(job.results[0].duration, 15.1);
  assert.equal(job.score.score, 96);
  assert.equal(job.captionTimings[0].end, 1.2);
});
