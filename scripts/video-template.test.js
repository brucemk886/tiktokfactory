import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PARKOUR_VIDEO_DIR,
  VIDEO_TEMPLATE_MIX,
  VIDEO_TEMPLATE_PARKOUR,
  isParkourVideoTemplate,
  normalizeVideoTemplate,
  parkourNeedsLoop,
  pickUnusedParkourSource,
  planParkourSources,
  resolveParkourVideoDir
} from "./video-template.js";

test("normalizes video template aliases", () => {
  assert.equal(normalizeVideoTemplate(""), VIDEO_TEMPLATE_MIX);
  assert.equal(normalizeVideoTemplate("mix"), VIDEO_TEMPLATE_MIX);
  assert.equal(normalizeVideoTemplate("parkour"), VIDEO_TEMPLATE_PARKOUR);
  assert.equal(normalizeVideoTemplate("2"), VIDEO_TEMPLATE_PARKOUR);
  assert.equal(normalizeVideoTemplate("template-2"), VIDEO_TEMPLATE_PARKOUR);
});

test("reads template from generation payload", () => {
  assert.equal(isParkourVideoTemplate({ videoTemplate: "parkour" }), true);
  assert.equal(isParkourVideoTemplate({ videoTemplate: "mix" }), false);
});

test("falls back to the default parkour folder", () => {
  assert.equal(resolveParkourVideoDir(""), DEFAULT_PARKOUR_VIDEO_DIR);
  assert.equal(resolveParkourVideoDir("E:\\custom"), "E:\\custom");
});

test("loops parkour video only when audio is longer", () => {
  assert.equal(parkourNeedsLoop(90, 90), false);
  assert.equal(parkourNeedsLoop(120, 90), false);
  assert.equal(parkourNeedsLoop(60, 90), true);
});

test("does not pick a parkour video that was already used", () => {
  const videos = [
    { id: "a", file: "a.mp4" },
    { id: "b", file: "b.mp4" }
  ];
  assert.equal(pickUnusedParkourSource(videos, { usedIds: ["a"] }).id, "b");
  assert.equal(pickUnusedParkourSource(videos, { usage: { assets: { a: { usedCount: 1 }, b: { usedCount: 1 } } } }), null);
});

const library = [
  { id: "v90", file: "v90.mp4", duration: 90 },
  { id: "v120", file: "v120.mp4", duration: 120 },
  { id: "v180", file: "v180.mp4", duration: 180 },
  { id: "v200", file: "v200.mp4", duration: 200 },
  { id: "v540", file: "v540.mp4", duration: 540 }
];

test("plans a single parkour video when one fits, choosing the shortest that covers the audio", () => {
  const plan = planParkourSources(library, 170);
  assert.equal(plan.mode, "single");
  assert.deepEqual(plan.sources.map((item) => item.id), ["v180"]);
  assert.equal(plan.waste, 10);
});

test("falls back to the long video only when the shorter ones cannot cover the audio", () => {
  // Left: 90, 120, 540. 90 + 120 = 210 < 300, so the 540 is the only way out.
  const plan = planParkourSources(library, 300, { usedIds: ["v180", "v200"] });
  assert.equal(plan.mode, "single");
  assert.deepEqual(plan.sources.map((item) => item.id), ["v540"]);
  assert.equal(plan.waste, 240);
});

test("stitches unused shorter videos longest-first and finishes with the best fitting remainder", () => {
  const plan = planParkourSources(library, 300, { usedIds: ["v540"] });
  assert.equal(plan.mode, "concat");
  // 200 first, then the shortest clip that covers the remaining 100 -> 120.
  assert.deepEqual(plan.sources.map((item) => item.id), ["v200", "v120"]);
  assert.equal(plan.waste, 20);
});

test("prefers the concat when the only single candidate wastes more footage", () => {
  const videos = [
    { id: "v100", file: "v100.mp4", duration: 100 },
    { id: "v110", file: "v110.mp4", duration: 110 },
    { id: "v540", file: "v540.mp4", duration: 540 }
  ];
  const plan = planParkourSources(videos, 200);
  assert.equal(plan.mode, "concat");
  assert.deepEqual(plan.sources.map((item) => item.id), ["v110", "v100"]);
  assert.equal(plan.waste, 10);
});

test("prefers the single video when waste is equal", () => {
  const videos = [
    { id: "v100", file: "v100.mp4", duration: 100 },
    { id: "v120", file: "v120.mp4", duration: 120 },
    { id: "v220", file: "v220.mp4", duration: 220 }
  ];
  // 120 + 100 wastes 20, the single 220 also wastes 20 -> one cut beats two.
  const plan = planParkourSources(videos, 200);
  assert.equal(plan.mode, "single");
  assert.deepEqual(plan.sources.map((item) => item.id), ["v220"]);
});

test("never reuses a parkour video and gives up when the remaining footage is too short", () => {
  assert.equal(planParkourSources(library, 300, { usedIds: ["v540", "v200", "v180"] }), null);
  assert.equal(planParkourSources(library, 60, { usage: { assets: Object.fromEntries(library.map((item) => [item.id, { usedCount: 1 }])) } }), null);
  assert.equal(planParkourSources([{ id: "x", file: "x.mp4" }], 60), null);
});
