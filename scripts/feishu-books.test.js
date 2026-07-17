import assert from "node:assert/strict";
import test from "node:test";
import { parseBookRows } from "./feishu-books.js";

test("parses the daily sheet and detects an unlabeled introduction column", () => {
  const rows = [
    ["日期", "💰英文书名", "💰英文书ID", "频道", "🔥小说卖点", "💰备注", ""],
    ["46219", "The Day I Left", "9277097408", "女频", "背叛 追妻火葬场", "强推", "这是一段足够长的小说开头内容，用来验证没有表头的简介列能够根据文本长度被自动识别。".repeat(3)]
  ];
  const parsed = parseBookRows(rows, { sheetId: "daily", sheetTitle: "重点书单" });
  assert.equal(parsed.headerRow, 1);
  assert.equal(parsed.books.length, 1);
  assert.equal(parsed.books[0].date, "2026-07-16");
  assert.equal(parsed.books[0].title, "The Day I Left");
  assert.equal(parsed.books[0].bookId, "9277097408");
  assert.equal(parsed.books[0].intro.startsWith("这是一段"), true);
});
test("skips banner rows and parses the full library header", () => {
  const rows = [
    ["新书在前，老书在后"],
    ["日期", "书名", "标签", "ID"],
    ["2026-07-16", "A New Story", "女频,重生,复仇", "4330654396"]
  ];
  const parsed = parseBookRows(rows, { sheetId: "all", sheetTitle: "全书库" });
  assert.equal(parsed.headerRow, 2);
  assert.deepEqual(parsed.books[0].tags, ["复仇", "女频", "重生"]);
  assert.equal(parsed.books[0].bookId, "4330654396");
});
