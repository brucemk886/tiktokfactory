import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OPENING_STYLE_IDS, OPENING_STYLES, SMART_OPENING_STYLE_ID, formatOpeningStyleBrief, publicOpeningStyles, resolveOpeningStyles } from "./novel-opening-styles.js";

test("opening styles are unique and resolve any number of picks", () => {
  assert.equal(new Set(OPENING_STYLES.map((item) => item.id)).size, OPENING_STYLES.length);
  assert.equal(OPENING_STYLES.length, 5);
  assert.deepEqual(DEFAULT_OPENING_STYLE_IDS, [SMART_OPENING_STYLE_ID]);
  assert.deepEqual(resolveOpeningStyles([SMART_OPENING_STYLE_ID]).map((item) => item.id), [SMART_OPENING_STYLE_ID]);
  const styles = resolveOpeningStyles(["cornered-counterstrike", "scene-meltdown", "identity-bomb"]);
  assert.deepEqual(styles.map((item) => item.id), ["cornered-counterstrike", "scene-meltdown", "identity-bomb"]);
  assert.throws(() => resolveOpeningStyles([]), /至少 1 种/);
  assert.deepEqual(resolveOpeningStyles([SMART_OPENING_STYLE_ID, SMART_OPENING_STYLE_ID]).map((item) => item.id), [SMART_OPENING_STYLE_ID, SMART_OPENING_STYLE_ID]);
  assert.deepEqual(resolveOpeningStyles(["conflict-first", "forbidden-line"]).map((item) => item.id), ["evidence-slam", "cornered-counterstrike"]);
});

test("every opening style defines a factual three-beat hook recipe", () => {
  for (const style of OPENING_STYLES) {
    assert.match(style.hook, /第一句/);
    assert.match(style.firstLine, /第一句/);
    assert.match(style.firstLine, /例：/);
    assert.match(style.threeBeat, /→/);
  }
  const brief = formatOpeningStyleBrief(OPENING_STYLES[0], 0);
  assert.match(brief, /智能最强钩子/);
  assert.match(brief, /三拍结构：/);
  assert.match(brief, /第一句做法：/);
  assert.match(brief, /Finally home/);
  const published = publicOpeningStyles();
  assert.equal(published.length, 5);
  assert.ok(published.every((item) => item.example));
  assert.equal(published.filter((item) => item.recommended).length, 1);
  assert.equal(published[0].id, SMART_OPENING_STYLE_ID);
});
