import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildEndCardDimFilter, buildNovelBadgeDrawtext, buildNovelEndCardDrawtext, buildOpeningTitleDrawtext, buildSpokenNarration, buildTikTokCaption, displayNovelPlatform, endCardNameParts, endCardStartAt, extractAudioCaptionText, fitOpeningTitle, hideCaptionsAfter, hideCaptionsUntil, novelAppIconSpec, novelPlatformHashtag, pickVariedHashtags, resolveEndCardStart, resolveNovelAppIconFile, resolveNovelEndCard, resolveNovelVideoBadge, resolveOpeningHookTitle, resolveOpeningTitleDuration, resolveTikTokCaption } from "./novel-video-badge.js";

test("end card uses each novel's promotion code and platform icon", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-end-card-"));
  const audioDir = path.join(workDir, "seed-audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, "opening-audio-endcard123.mp3");
  fs.writeFileSync(audioPath, "audio");
  fs.mkdirSync(path.join(workDir, "audio-library"), { recursive: true });
  fs.writeFileSync(path.join(workDir, "audio-library", "index.json"), JSON.stringify([{
    id: "audio-endcard123",
    fileName: "opening-audio-endcard123.mp3",
    targetAudioPath: audioPath,
    source: { novelId: "novel-1", scriptId: "script-1" }
  }]));
  fs.writeFileSync(path.join(workDir, "novel-content-library.json"), JSON.stringify({
    novels: [{ id: "novel-1", title: "Hidden Family", platform: "NovelMaster", bookId: "464137", promotionCode: "454311" }],
    scripts: [{ id: "script-1", novelId: "novel-1", audioId: "audio-endcard123" }]
  }));

  const card = resolveNovelEndCard({ workDir, audioPath });
  assert.equal(card.searchCode, "454311");
  assert.equal(card.bookId, "464137");
  assert.equal(card.promotionCode, "454311");
  assert.equal(card.displayPlatform, "Novel Master");
  assert.equal(card.icon.key, "novelmaster");
  assert.equal(card.icon.fileName, "novelmaster.png");
  assert.equal(novelAppIconSpec("GoodNovel").fileName, "goodnovel.png");
  assert.ok(resolveNovelAppIconFile("NovelMaster").endsWith("novelmaster.png"));
  assert.ok(resolveNovelAppIconFile("GoodNovel").endsWith("goodnovel.png"));
  assert.ok(resolveNovelAppIconFile("MotoNovel").endsWith("motonovel.png"));
  assert.deepEqual(endCardNameParts("NovelMaster").map((item) => item.text), ["Novel", "Master"]);
  const filters = buildNovelEndCardDrawtext({ card, startAt: 12, fontFile: "C:/Windows/Fonts/msyhbd.ttc" });
  const joined = filters.join(",");
  assert.match(joined, /text='Search'/);
  assert.match(joined, /text='454311'/);
  assert.doesNotMatch(joined, /text='464137'/);
  assert.match(joined, /text='Novel'/);
  assert.match(joined, /text='Master'/);
  assert.match(joined, /text='to read whole story'/);
  assert.match(joined, /enable='gte\(t,12\.00\)'/);
  assert.match(buildEndCardDimFilter(12), /gte\(t,12\.00\)/);
  assert.equal(endCardStartAt(15, 3), 12);
  assert.equal(resolveEndCardStart(60, {
    words: [
      { text: "Search", start: 54.2, end: 54.5 },
      { text: "454311", start: 54.5, end: 55.4 }
    ],
    cues: [
      { text: "I closed the door.", start: 50, end: 52 },
      { text: "Search 2763520548 on the Novel Master app", start: 54.2, end: 57.1 },
      { text: "to read the full story.", start: 57.1, end: 58.8 }
    ]
  }), 54.2);
  assert.equal(resolveEndCardStart(15, { cues: [{ text: "I closed the door.", start: 10, end: 14 }] }), 12);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("end card never falls back to the book id", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-end-card-bookid-"));
  fs.writeFileSync(path.join(workDir, "novel-content-library.json"), JSON.stringify({
    novels: [{ id: "novel-1", title: "Hidden Family", platform: "NovelMaster", bookId: "464137" }],
    scripts: []
  }));
  const card = resolveNovelEndCard({
    workDir,
    audioPath: path.join(workDir, "missing.mp3"),
    fallback: { novelId: "novel-1" }
  });
  assert.equal(card.searchCode, "");
  assert.equal(card.bookId, "464137");
  const joined = buildNovelEndCardDrawtext({ card, startAt: 12 }).join(",");
  assert.doesNotMatch(joined, /text='464137'/);
  assert.doesNotMatch(joined, /text='Search'/);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("hides captions during the end card window", () => {
  const hidden = hideCaptionsAfter({
    cues: [
      { text: "before", start: 8, end: 11 },
      { text: "overlap", start: 11.5, end: 13.2 },
      { text: "after", start: 13.4, end: 15 }
    ],
    words: [
      { text: "keep", start: 8, end: 8.4 },
      { text: "drop", start: 13.5, end: 13.8 }
    ]
  }, 12);
  assert.deepEqual(hidden.cues.map((item) => [item.text, item.end]), [["before", 11], ["overlap", 12]]);
  assert.deepEqual(hidden.words.map((item) => item.text), ["keep"]);
});

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

test("reads platform and promotion code from saved local audio metadata", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-badge-sidecar-"));
  const audioDir = path.join(workDir, "saved-audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, "opening.mp3");
  fs.writeFileSync(audioPath, "audio");
  fs.writeFileSync(path.join(audioDir, "novel.json"), JSON.stringify({
    novelId: "novel-sidecar",
    novelTitle: "Saved Local Book",
    platform: "MotoNovel",
    promotionCode: "778899"
  }));
  fs.writeFileSync(path.join(workDir, "novel-content-library.json"), JSON.stringify({ novels: [], scripts: [] }));

  const badge = resolveNovelVideoBadge({ workDir, audioPath });
  assert.equal(badge.platform, "MotoNovel");
  assert.equal(badge.promotionCode, "778899");
  const card = resolveNovelEndCard({ workDir, audioPath });
  assert.equal(card.searchCode, "778899");
  assert.equal(card.displayPlatform, "MotoNovel");
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

test("TikTok captions join audio title, promotion copy, and a compact platform hashtag", () => {
  assert.equal(novelPlatformHashtag("NovelMaster"), "#NovelMaster");
  assert.equal(novelPlatformHashtag("Novel Master"), "#NovelMaster");
  assert.equal(novelPlatformHashtag("GoodNovel"), "#GoodNovel");
  assert.equal(buildTikTokCaption({
    openingTitle: "She married my uncle",
    promotionCopy: "Read the full story on Novel Master. Code 454311",
    platform: "NovelMaster"
  }), [
    "She married my uncle",
    "Read the full story on Novel Master. Code 454311",
    pickVariedHashtags({ seed: "She married my uncle", platform: "NovelMaster" }).join(" ")
  ].join("\n\n"));
  assert.equal(buildTikTokCaption({
    audioTitle: "conflict-first",
    platform: "GoodNovel"
  }), [
    "conflict first",
    pickVariedHashtags({ seed: "conflict first", platform: "GoodNovel" }).join(" ")
  ].join("\n\n"));
  assert.equal(extractAudioCaptionText("[music]20240203_reddit_stories_viral7_7331240398574112002_This is messes up.mp3"), "This is messes up");
  assert.equal(extractAudioCaptionText("plain.mp3", "He found the letter under the door. Then he ran."), "plain");
  const firstTags = pickVariedHashtags({ seed: "This is messes up" }).join(" ");
  const secondTags = pickVariedHashtags({ seed: "She married my uncle" }).join(" ");
  assert.match(firstTags, /#reddit|#storytime|#aita/);
  assert.notEqual(firstTags, secondTags);
});

test("auto TikTok captions prefer the video fields and look up the book list when needed", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiktok-caption-"));
  fs.mkdirSync(path.join(workDir, "audio-library"), { recursive: true });
  fs.writeFileSync(path.join(workDir, "audio-library", "index.json"), JSON.stringify([{
    id: "audio-caption-1",
    fileName: "audio-caption-1.mp3",
    source: { novelId: "novel-1", scriptId: "script-1" }
  }]));
  fs.writeFileSync(path.join(workDir, "novel-content-library.json"), JSON.stringify({
    novels: [{ id: "novel-1", platform: "NovelMaster", promotionCopy: "Unlock the rest with code 454311." }],
    scripts: [{ id: "script-1", novelId: "novel-1", audioId: "audio-caption-1", openingTitle: "She married my uncle" }]
  }));

  assert.equal(resolveTikTokCaption({
    captionMode: "manual",
    manualCaption: "custom #tag"
  }), "custom #tag");
  assert.equal(resolveTikTokCaption({
    captionMode: "auto",
    video: {
      openingTitle: "The invitation was a trap",
      promotionCopy: "Continue on GoodNovel.",
      novelPlatform: "GoodNovel"
    },
    manualCaption: "should not be used"
  }), buildTikTokCaption({
    openingTitle: "The invitation was a trap",
    promotionCopy: "Continue on GoodNovel.",
    platform: "GoodNovel"
  }));
  assert.equal(resolveTikTokCaption({
    workDir,
    captionMode: "auto",
    video: { audioName: "audio-caption-1.mp3", novelId: "novel-1" }
  }), buildTikTokCaption({
    promotionCopy: "Unlock the rest with code 454311.",
    platform: "NovelMaster",
    audioTitle: "audio-caption-1.mp3"
  }));
  const redditCaption = resolveTikTokCaption({
    captionMode: "auto",
    video: { audioName: "plain.mp3" },
    manualCaption: "#reddit"
  });
  assert.match(redditCaption, /^plain\n\n#/);
  assert.notEqual(redditCaption, "#reddit");
  fs.rmSync(workDir, { recursive: true, force: true });
});
