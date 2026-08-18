import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OPENING_STYLE_IDS, OPENING_STYLES, formatOpeningStyleBrief, publicOpeningStyles, resolveOpeningStyles } from "./novel-opening-styles.js";

test("opening styles are unique and resolve any number of picks", () => {
  assert.equal(new Set(OPENING_STYLES.map((item) => item.id)).size, OPENING_STYLES.length);
  assert.equal(DEFAULT_OPENING_STYLE_IDS.length, 4);
  assert.deepEqual(resolveOpeningStyles(["conflict-first"]).map((item) => item.id), ["conflict-first"]);
  const styles = resolveOpeningStyles(["forbidden-line", "betrayal-caught", "secret-reveal"]);
  assert.deepEqual(styles.map((item) => item.id), ["forbidden-line", "betrayal-caught", "secret-reveal"]);
  assert.throws(() => resolveOpeningStyles([]), /至少 1 种/);
  assert.deepEqual(resolveOpeningStyles(["conflict-first", "conflict-first"]).map((item) => item.id), ["conflict-first", "conflict-first"]);
});

test("every opening style forces a first-sentence recipe", () => {
  for (const style of OPENING_STYLES) {
    assert.match(style.hook, /第一句/);
    assert.match(style.firstLine, /第一句/);
    assert.match(style.firstLine, /例：/);
  }
  const brief = formatOpeningStyleBrief(OPENING_STYLES[0], 0);
  assert.match(brief, /第一句做法：/);
  assert.match(brief, /Why is the bride wearing my mother's ring/);
  const published = publicOpeningStyles();
  assert.equal(published.length, 4);
  assert.ok(published.every((item) => item.example));
});
