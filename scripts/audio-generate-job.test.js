import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveTargetAudioDir, todayAudioFolderName } from "./audio-library-groups.js";
import { runAudioGenerateJob } from "./audio-generate-job.js";

test("creates a novel-named folder under the audio library", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-novel-"));
  const dir = resolveTargetAudioDir({ audioLibraryRoot: root }, "__novel__", { novelTitle: "The Housemaid" });
  assert.equal(dir, path.join(root, "The Housemaid"));
  assert.ok(fs.existsSync(dir));
  const today = resolveTargetAudioDir({ audioLibraryRoot: root }, "__today__", { date: new Date("2026-08-18T12:00:00") });
  assert.equal(today, path.join(root, "0818"));
  assert.equal(todayAudioFolderName(new Date("2026-08-18T12:00:00")), "0818");
  fs.rmSync(root, { recursive: true, force: true });
});

test("copies existing local audio into the fixed library folder", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-copy-"));
  const source = path.join(root, "source.mp3");
  fs.writeFileSync(source, "audio-bytes");
  const target = path.join(root, "0818");
  const result = await runAudioGenerateJob({
    root,
    workDir: path.join(root, "work"),
    config: { audioLibraryRoot: root },
    payload: {
      targetAudioDir: target,
      items: [{
        scriptId: "script-one",
        title: "第一章开头",
        audioId: "audio-abc123456789",
        targetAudioPath: source,
        script: "This opening is long enough to pass the twenty character check."
      }]
    },
    audioLibrary: {
      get() { return null; },
      resolveAudioPath() { return ""; }
    },
    novelContentLibrary: { attachScriptAudio() { return {}; } }
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].cacheHit, true);
  assert.ok(fs.existsSync(result.items[0].targetAudioPath));
  assert.equal(path.dirname(result.items[0].targetAudioPath), target);
  fs.rmSync(root, { recursive: true, force: true });
});

test("uses the job payload voice when an item omits voiceId", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-voice-"));
  let usedVoice = "";
  const result = await runAudioGenerateJob({
    root,
    workDir: path.join(root, "work"),
    config: { audioLibraryRoot: root },
    payload: {
      voiceId: "voice-from-page",
      items: [{
        scriptId: "script-voice",
        title: "Opening",
        script: "This opening is long enough to pass the twenty character check."
      }]
    },
    audioLibrary: {
      generateFromScript: async (input) => {
        usedVoice = input.voiceId;
        return { id: "audio-new", title: input.title, fileName: "opening.mp3" };
      },
      resolveAudioPath() { return ""; }
    }
  });
  assert.equal(result.items.length, 1);
  assert.equal(usedVoice, "voice-from-page");
  fs.rmSync(root, { recursive: true, force: true });
});
