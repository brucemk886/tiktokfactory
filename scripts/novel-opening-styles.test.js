import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OPENING_STYLE_IDS, OPENING_STYLES, resolveOpeningStyles } from "./novel-opening-styles.js";

test("opening styles are unique and resolve any number of picks", () => {
  assert.equal(new Set(OPENING_STYLES.map((item) => item.id)).size, OPENING_STYLES.length);
  assert.equal(DEFAULT_OPENING_STYLE_IDS.length, 3);
  assert.deepEqual(resolveOpeningStyles(["conflict-first"]).map((item) => item.id), ["conflict-first"]);
  const styles = resolveOpeningStyles(["forbidden-line", "deadline-lock", "ending-flash"]);
  assert.deepEqual(styles.map((item) => item.id), ["forbidden-line", "deadline-lock", "ending-flash"]);
  assert.throws(() => resolveOpeningStyles([]), /至少 1 种/);
  assert.deepEqual(resolveOpeningStyles(["conflict-first", "conflict-first"]).map((item) => item.id), ["conflict-first", "conflict-first"]);
});
