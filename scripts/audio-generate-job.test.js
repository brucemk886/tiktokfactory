import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveTargetAudioDir, todayAudioFolderName } from "./audio-library-groups.js";
import { runAudioGenerateJob } from "./audio-generate-job.js";

test("creates a novel-named folder under the platform directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-novel-"));
  const dir = resolveTargetAudioDir({ audioLibraryRoot: root }, "__novel__", {
    novelTitle: "The Housemaid",
    platform: "GoodNovel"
  });
  assert.equal(dir, path.join(root, "GoodNovel", "The Housemaid"));
  assert.ok(fs.existsSync(dir));
  const unassigned = resolveTargetAudioDir({ audioLibraryRoot: root }, "__novel__", { novelTitle: "The Housemaid" });
  assert.equal(unassigned, path.join(root, "未分平台", "The Housemaid"));
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
        script: "This opening is long enough to pass the twenty character check.",
        platform: "NovelMaster",
        promotionCode: "454311"
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
  const folderMeta = JSON.parse(fs.readFileSync(path.join(target, "novel.json"), "utf8"));
  assert.equal(folderMeta.platform, "NovelMaster");
  assert.equal(folderMeta.promotionCode, "454311");
  assert.equal(fs.existsSync(`${result.items[0].targetAudioPath}.json`), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("copies existing local audio into the novel platform folder", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-platform-copy-"));
  const source = path.join(root, "source.mp3");
  fs.writeFileSync(source, "audio-bytes");
  const result = await runAudioGenerateJob({
    root,
    workDir: path.join(root, "work"),
    config: { audioLibraryRoot: root },
    payload: {
      targetAudioDir: "__novel__",
      items: [{
        scriptId: "script-platform",
        novelTitle: "The Housemaid",
        title: "Opening",
        audioId: "audio-plat123456789",
        targetAudioPath: source,
        script: "This opening is long enough to pass the twenty character check.",
        platform: "GoodNovel",
        promotionCode: "GN-88"
      }]
    },
    audioLibrary: {
      get() { return null; },
      resolveAudioPath() { return ""; }
    },
    novelContentLibrary: { attachScriptAudio() { return {}; } }
  });
  const expectedDir = path.join(root, "GoodNovel", "The Housemaid");
  assert.equal(path.dirname(result.items[0].targetAudioPath), expectedDir);
  const folderMeta = JSON.parse(fs.readFileSync(path.join(expectedDir, "novel.json"), "utf8"));
  assert.equal(folderMeta.platform, "GoodNovel");
  assert.equal(folderMeta.promotionCode, "GN-88");
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
      ttsProvider: "elevenlabs",
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

test("defaults new audio jobs to Kokoro and remaps old ElevenLabs voice ids", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-kokoro-job-"));
  let used = null;
  await runAudioGenerateJob({
    root,
    workDir: path.join(root, "work"),
    config: { audioLibraryRoot: root },
    payload: {
      voiceId: "cgSgspJ2msm6clMCkdW9",
      items: [{
        scriptId: "script-kokoro",
        title: "Opening",
        script: "This opening is long enough to pass the twenty character check."
      }]
    },
    audioLibrary: {
      generateFromScript: async (input) => {
        used = input;
        return { id: "audio-new", title: input.title, fileName: "opening.mp3" };
      },
      resolveAudioPath() { return ""; }
    }
  });
  assert.equal(used.ttsProvider, "kokoro");
  assert.equal(used.voiceId, "am_adam");
  fs.rmSync(root, { recursive: true, force: true });
});

test("writes caption cache when imported peer audio already has words", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-peer-cache-"));
  const workDir = path.join(root, "work");
  const source = path.join(root, "source.mp3");
  fs.writeFileSync(source, "peer-audio-bytes-for-caption-cache");
  const result = await runAudioGenerateJob({
    root,
    workDir,
    config: { audioLibraryRoot: root },
    payload: {
      targetAudioDir: path.join(root, "NovelMaster", "Peer Book"),
      items: [{
        scriptId: "script-peer",
        title: "同行爆款",
        audioId: "audio-peer123456",
        targetAudioPath: source,
        script: "She spread a dirty lie about me in front of everyone.",
        words: [
          { text: "She", start: 0, end: 0.2 },
          { text: "spread", start: 0.2, end: 0.5 }
        ],
        sourceType: "peer-hit"
      }]
    },
    audioLibrary: {
      get() { return null; },
      resolveAudioPath() { return ""; }
    }
  });
  const cacheDir = path.join(workDir, "caption-cache");
  const files = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((name) => name.endsWith(".json")) : [];
  assert.ok(files.length >= 1, "peer transcript should land in caption cache");
  const cached = JSON.parse(fs.readFileSync(path.join(cacheDir, files[0]), "utf8"));
  assert.equal(cached.provider, "elevenlabs");
  assert.equal(cached.text, "She spread a dirty lie about me in front of everyone.");
  assert.ok(fs.existsSync(result.items[0].targetAudioPath));
  fs.rmSync(root, { recursive: true, force: true });
});
