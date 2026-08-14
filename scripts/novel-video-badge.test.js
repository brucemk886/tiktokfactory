import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildNovelBadgeDrawtext, buildOpeningTitleDrawtext, buildSpokenNarration, displayNovelPlatform, fitOpeningTitle, hideCaptionsUntil, resolveNovelVideoBadge, resolveOpeningHookTitle, resolveOpeningTitleDuration } from "./novel-video-badge.js";

test("formats NovelMaster as two words for the burned-in badge", () => {
  assert.equal(displayNovelPlatform("NovelMaster"), "Novel Master");
  assert.equal(displayNovelPlatform("GoodNovel"), "GoodNovel");
});

test("resolves platform and promotion code from the audio file and book list", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-badge-"));
  const audioDir = path.join(workDir, "seed-audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, "opening-audio-abc123456789.mp3");
  fs.writeFileSync(audioPath, "audio");
  fs.mkdirSync(path.join(workDir, "audio-library"), { recursive: true });
  fs.writeFileSync(path.join(workDir, "audio-library", "index.json"), JSON.stringify([{
    id: "audio-abc123456789",
    fileName: "audio-abc123456789.mp3",
    targetAudioPath: audioPath,
    source: { novelId: "novel-1", scriptId: "script-1" }
  }]));
  fs.writeFileSync(path.join(workDir, "novel-content-library.json"), JSON.stringify({
    novels: [{ id: "novel-1", title: "Hidden Family", platform: "NovelMaster", promotionCode: "454311" }],
    scripts: [{ id: "script-1", novelId: "novel-1", audioId: "audio-abc123456789" }]
  }));

  const badge = resolveNovelVideoBadge({ workDir, audioPath });
  assert.equal(badge.promotionCode, "454311");
  assert.equal(badge.displayPlatform, "Novel Master");
  assert.deepEqual(badge.lines, ["454311", "Novel Master"]);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("falls back to the selected novel when the audio is not in the library", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-badge-fallback-"));
  fs.writeFileSync(path.join(workDir, "novel-content-library.json"), JSON.stringify({
    novels: [{ id: "novel-2", title: "Kitchen Letter", platform: "GoodNovel", promotionCode: "GN-88" }],
    scripts: []
  }));
  const badge = resolveNovelVideoBadge({
    workDir,
    audioPath: path.join(workDir, "missing.mp3"),
    fallback: { novelId: "novel-2" }
  });
  assert.equal(badge.platform, "GoodNovel");
  assert.equal(badge.promotionCode, "GN-88");
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("writes a two-line ffmpeg drawtext filter for the top-left badge", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-badge-filter-"));
  const textFile = path.join(workDir, "badge.txt");
  const filter = buildNovelBadgeDrawtext({
    badge: { lines: ["454311", "Novel Master"] },
    fontFile: "C:/Windows/Fonts/msyhbd.ttc",
    textFile
  });
  assert.match(filter, /drawtext=/);
  assert.match(filter, /text='454311'/);
  assert.match(filter, /text='Novel Master'/);
  assert.match(filter, /y=168/);
  assert.match(filter, /y=237/);
  assert.doesNotMatch(filter, /text='454311\\nNovel Master'/);
  assert.match(filter, /expansion=none/);
  assert.doesNotMatch(filter, /textfile=/);
  assert.match(filter, /fontcolor=white/);
  assert.match(filter, /bordercolor=black/);
  assert.equal(fs.readFileSync(textFile, "utf8"), "454311\nNovel Master");
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("resolves the opening hook title from the matched script", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-hook-"));
  const audioDir = path.join(workDir, "seed-audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, "opening-audio-hook123456.mp3");
  fs.writeFileSync(audioPath, "audio");
  fs.mkdirSync(path.join(workDir, "audio-library"), { recursive: true });
  fs.writeFileSync(path.join(workDir, "audio-library", "index.json"), JSON.stringify([{
    id: "audio-hook123456",
    fileName: "opening-audio-hook123456.mp3",
    targetAudioPath: audioPath,
    source: { novelId: "novel-1", scriptId: "script-1" }
  }]));
  fs.writeFileSync(path.join(workDir, "novel-content-library.json"), JSON.stringify({
    novels: [{ id: "novel-1", title: "Hidden Family", platform: "NovelMaster" }],
    scripts: [{
      id: "script-1",
      novelId: "novel-1",
      audioId: "audio-hook123456",
      openingTitle: "She married my uncle",
      text: "She married my uncle after I found the letter he hid in the church pew."
    }]
  }));

  assert.equal(resolveOpeningHookTitle({ workDir, audioPath }), "She married my uncle");
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("writes a centered 3-second ffmpeg drawtext filter for the opening title", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-hook-filter-"));
  const textFile = path.join(workDir, "opening-title.txt");
  const filter = buildOpeningTitleDrawtext({
    title: "She married my uncle",
    fontFile: "C:/Windows/Fonts/msyhbd.ttc",
    textFile
  });
  assert.match(filter, /drawtext=/);
  assert.match(filter, /text='She married my'/);
  assert.match(filter, /text='uncle'/);
  assert.match(filter, /x=\(w-text_w\)\/2/);
  assert.match(filter, /y=\(h-text_h\)\/2/);
  assert.match(filter, /enable='lt\(t,3\)'/);
  assert.match(filter, /box=1/);
  assert.doesNotMatch(filter, /textfile=/);
  assert.equal(fs.readFileSync(textFile, "utf8"), "She married my\nuncle");
  assert.equal(buildOpeningTitleDrawtext({ title: "", textFile }), "");
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("wraps a long opening title to stay inside 80 percent of the frame", () => {
  const fitted = fitOpeningTitle("She married my uncle after the church found the hidden letter in the pew", { width: 1080, fontSize: 72 });
  assert.ok(fitted.text.includes("\n"));
  assert.ok(fitted.text.split("\n").length <= 3);
  assert.ok(fitted.fontSize <= 72);
  const filter = buildOpeningTitleDrawtext({
    title: "She married my uncle after the church found the hidden letter in the pew",
    width: 1080,
    fontFile: "C:/Windows/Fonts/msyhbd.ttc"
  });
  assert.doesNotMatch(filter, /text='[^']*\\n[^']*'/);
  assert.match(filter, /drawtext=.*drawtext=/);
});

test("spoken narration prepends the hook title unless the script already starts with it", () => {
  assert.equal(
    buildSpokenNarration("She married my uncle", "The church went silent when I said his name."),
    "She married my uncle The church went silent when I said his name."
  );
  assert.equal(
    buildSpokenNarration("She married my uncle", "She married my uncle after I found the letter."),
    "She married my uncle after I found the letter."
  );
  assert.equal(buildSpokenNarration("", "Just the body."), "Just the body.");
});

test("opening title duration follows spoken title words and hides overlapping captions", () => {
  const captions = {
    words: [
      { text: "She", start: 0, end: 0.3 },
      { text: "married", start: 0.3, end: 0.7 },
      { text: "my", start: 0.7, end: 0.9 },
      { text: "uncle", start: 0.9, end: 1.4 },
      { text: "The", start: 1.8, end: 2.1 }
    ],
    cues: [
      { text: "She married my uncle", start: 0, end: 1.4 },
      { text: "The church went silent", start: 1.8, end: 3.6 }
    ]
  };
  const until = resolveOpeningTitleDuration("She married my uncle", captions, 3);
  assert.ok(until >= 1.4 && until <= 1.6);
  const hidden = hideCaptionsUntil(captions, until);
  assert.equal(hidden.cues.length, 1);
  assert.equal(hidden.cues[0].text, "The church went silent");
  assert.equal(hidden.words[0].text, "The");
});
