import assert from "node:assert/strict";
import test from "node:test";
import {
  batchOpeningStyleIds,
  clampBatchAudioVersionCount,
  firstHookLine,
  openingVariantScriptPayloads,
  remainingAudioVersionCount,
  uniqueNovelIds
} from "./novel-batch-audio.js";

test("default batch is three auto-picked styles", () => {
  assert.deepEqual(batchOpeningStyleIds(), ["auto", "auto", "auto"]);
  assert.equal(clampBatchAudioVersionCount(99), 5);
  assert.equal(clampBatchAudioVersionCount("nope"), 3);
});

test("skips books that already have enough kept or voiced scripts", () => {
  const scripts = [
    { id: "a", kept: true },
    { id: "b", audioId: "audio-1" },
    { id: "c", text: "draft only" }
  ];
  assert.equal(remainingAudioVersionCount(scripts, 3), 1);
  assert.equal(remainingAudioVersionCount([{ kept: true }, { kept: true }, { audioId: "x" }], 3), 0);
});

test("maps generated variants onto kept audio-page scripts", () => {
  const payloads = openingVariantScriptPayloads({ title: "Sold Tonight" }, [
    { styleLabel: "智能最强钩子", openingTitle: "He sold me", script: "He sold me tonight after dinner and I smiled at the door. ".repeat(3) },
    { styleLabel: "智能最强钩子", script: "short" }
  ]);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].kept, true);
  assert.equal(payloads[0].sourceType, "ai-style-rewrite");
  assert.equal(payloads[0].openingTitle, "He sold me");
});

test("rewrite variants can keep the checked peer script as parent", () => {
  const payloads = openingVariantScriptPayloads({ title: "Sold Tonight" }, [
    { styleLabel: "智能最强钩子", openingTitle: "He sold me", script: "He sold me tonight after dinner and I smiled at the door. ".repeat(3) }
  ], { parentScriptId: "peer-1" });
  assert.equal(payloads[0].parentScriptId, "peer-1");
});

test("first hook line and id list stay compact", () => {
  assert.equal(firstHookLine("  \nShe left.\nThe rest"), "She left.");
  assert.deepEqual(uniqueNovelIds(["a", "", "a", "b"]), ["a", "b"]);
});
