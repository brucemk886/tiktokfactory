import assert from "node:assert/strict";
import test from "node:test";
import {
  isImportedAudioFile,
  planImportedAudioAssignments,
  uploadedAudioOpeningTitle,
  uploadedAudioScriptText
} from "./novel-audio-import.js";

test("imported files attach to pending scripts in order then create extras", () => {
  const plan = planImportedAudioAssignments({
    pendingScripts: [
      { id: "s1" },
      { id: "s2", audioId: "already" },
      { id: "s3" }
    ],
    files: [{ name: "a.mp3" }, { name: "b.mp3" }, { name: "c.mp3" }]
  });
  assert.deepEqual(plan.map((item) => [item.scriptId, item.createNew]), [
    ["s1", false],
    ["s3", false],
    ["", true]
  ]);
});

test("explicit script ids win over leftover pending cards", () => {
  const plan = planImportedAudioAssignments({
    pendingScripts: [{ id: "s1" }, { id: "s2" }],
    scriptIds: ["s2"],
    files: [{ name: "only.mp3" }]
  });
  assert.equal(plan[0].scriptId, "s2");
  assert.equal(plan[0].createNew, false);
});

test("uploaded audio helpers keep a playable title and long enough script", () => {
  assert.equal(uploadedAudioOpeningTitle("Hook Line.mp3"), "Hook Line");
  assert.ok(uploadedAudioScriptText("Hook Line.mp3").length >= 20);
  assert.equal(isImportedAudioFile({ name: "a.mp3", type: "" }), true);
  assert.equal(isImportedAudioFile({ name: "a.wav", type: "audio/wav" }), false);
});
