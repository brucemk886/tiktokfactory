import assert from "node:assert/strict";
import test from "node:test";
import {
  makeWordPopSubtitles,
  normalizePopWords,
  normalizeSubtitleAnimationMode,
  subtitleNeedsWordTimestamps
} from "./subtitle-animation.js";

test("word-pop is a first-class subtitle mode", () => {
  assert.equal(normalizeSubtitleAnimationMode("word-pop"), "word-pop");
  assert.equal(normalizeSubtitleAnimationMode("word-highlight"), "word-highlight");
  assert.equal(normalizeSubtitleAnimationMode("sentence"), "sentence");
  assert.equal(normalizeSubtitleAnimationMode(""), "sentence");
  assert.equal(subtitleNeedsWordTimestamps("word-pop"), true);
  assert.equal(subtitleNeedsWordTimestamps("word-highlight"), true);
  assert.equal(subtitleNeedsWordTimestamps("sentence"), false);
});

test("word-pop writes one popping word at a time", () => {
  const ass = makeWordPopSubtitles([
    { text: "She", start: 0, end: 0.2 },
    { text: "left.", start: 0.2, end: 0.5 },
    { text: "Tonight", start: 0.55, end: 0.9 }
  ], { width: 1080, height: 1920, fontFile: "C:/Windows/Fonts/arial.ttf", fontSize: 62, yPercent: 66 });
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:00\.20,Default,,0,0,0,,\{\\fscx72\\fscy72\\t\(0,90,\\fscx100\\fscy100\)\}She/);
  assert.match(ass, /Dialogue: 0,0:00:00\.20,0:00:00\.55,Default,,0,0,0,,\{\\fscx72\\fscy72\\t\(0,90,\\fscx100\\fscy100\)\}left/);
  assert.match(ass, /Tonight/);
  assert.doesNotMatch(ass, /She left/);
  assert.equal(normalizePopWords([{ text: "...", start: 0, end: 1 }]).length, 0);
});
