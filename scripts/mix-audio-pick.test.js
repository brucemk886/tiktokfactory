import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { audioHitWeight, pickWeightedIndex, planMixAudioOrder, readAudioHitWeights, refreshAudioHitWeights, writeAudioHitWeights } from "./mix-audio-pick.js";

test("hit audios get a higher draw weight than ordinary ones", () => {
  assert.equal(audioHitWeight(0), 1);
  assert.ok(audioHitWeight(2_800_000) > audioHitWeight(650_000));
  assert.ok(audioHitWeight(650_000) > audioHitWeight(0));
});

test("mix audio order is a random permutation, not filename order", () => {
  const files = ["a.mp3", "b.mp3", "c.mp3", "d.mp3"];
  const first = planMixAudioOrder(files, { random: () => 0.99 });
  const second = planMixAudioOrder(files, { random: () => 0.01 });
  assert.equal(first.length, 4);
  assert.deepEqual([...first].sort(), files);
  assert.notDeepEqual(first, files);
  assert.notDeepEqual(first, second);
});

test("higher play count is more likely to be picked first", () => {
  const files = ["normal.mp3", "hit.mp3"];
  const weightsByName = { "hit.mp3": 2_800_000, "normal.mp3": 0 };
  let hitFirst = 0;
  for (let index = 0; index < 400; index += 1) {
    const order = planMixAudioOrder(files, { weightsByName });
    if (order[0] === "hit.mp3") hitFirst += 1;
  }
  assert.ok(hitFirst > 300, `hitFirst=${hitFirst}`);
});

test("readAudioHitWeights maps file names to play counts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-hit-"));
  fs.writeFileSync(path.join(dir, "audio-hit-weights.json"), JSON.stringify({
    "Hit Story.mp3": 120000,
    "D:\\\\audio\\\\Hit Story.mp3": 2800000
  }));
  const weights = readAudioHitWeights(dir);
  assert.equal(weights["hit story.mp3"], 2_800_000);
});

test("empty weights still pick a valid index", () => {
  assert.equal(pickWeightedIndex([]), 0);
  assert.equal(pickWeightedIndex([0, 0], () => 0.4), 0);
});

test("refreshAudioHitWeights writes the factory snapshot", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-hit-refresh-"));
  fs.writeFileSync(path.join(dir, "factory-cloud-worker.json"), JSON.stringify({
    url: "https://factory.example.test",
    token: "test-token"
  }));
  const fetched = await refreshAudioHitWeights(dir, async () => ({
    ok: true,
    json: async () => ({ weights: { "Hit Story.mp3": 2_800_000 } })
  }));
  assert.equal(fetched["hit story.mp3"], 2_800_000);
  assert.equal(readAudioHitWeights(dir)["hit story.mp3"], 2_800_000);
  writeAudioHitWeights(dir, { "plain.mp3": 10 });
  assert.equal(readAudioHitWeights(dir)["plain.mp3"], 10);
});
