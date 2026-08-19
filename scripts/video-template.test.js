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

test("falls back to the 0818 parkour folder", () => {
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
