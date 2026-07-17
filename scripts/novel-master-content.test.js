import test from "node:test";
import assert from "node:assert/strict";
import { extractFreeContent } from "./novel-master-content.js";

test("keeps only the free text before a paid cutoff", () => {
  assert.equal(extractFreeContent({ content: "1\nfree chapter\nLOCK\npaid chapter", cutoffSegment: "LOCK", type: "locked" }), "1\nfree chapter");
});
test("keeps all content when the story is free", () => {
  assert.equal(extractFreeContent({ content: "1\nfree\nLOCK\nmore", cutoffSegment: "LOCK", type: "free" }), "1\nfree\nLOCK\nmore");
});
