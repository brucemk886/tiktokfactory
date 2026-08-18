import assert from "node:assert/strict";
import test from "node:test";
import { beijingDateKey, filterJournalEntries, normalizeJournalEntry } from "./work-journal.js";

test("normalizes daily work and mindmap entries", () => {
  const work = normalizeJournalEntry({ kind: "daily_work", title: "出片", dateKey: "2026-08-18", body: "发了 3 条" }, { id: "a", now: 1 });
  assert.equal(work.kind, "daily_work");
  assert.equal(work.body, "发了 3 条");
  const map = normalizeJournalEntry({ kind: "mindmap", title: "选题", dateKey: "2026-08-18", mindmap: { text: "根", children: [{ text: "子" }] } }, { id: "b", now: 1 });
  assert.equal(map.mindmap.text, "根");
  assert.equal(map.mindmap.children[0].text, "子");
});

test("filters journal entries by kind and query", () => {
  const rows = filterJournalEntries([
    { id: "1", kind: "essay", title: "随笔甲", body: "天气", dateKey: "2026-08-18", updatedAt: 2 },
    { id: "2", kind: "daily_work", title: "出片", body: "工厂", dateKey: "2026-08-17", updatedAt: 1 },
  ], { kind: "essay", query: "天气" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "1");
});

test("beijing date key stays YYYY-MM-DD", () => {
  assert.match(beijingDateKey(Date.parse("2026-08-18T01:00:00+08:00")), /^\d{4}-\d{2}-\d{2}$/);
});
