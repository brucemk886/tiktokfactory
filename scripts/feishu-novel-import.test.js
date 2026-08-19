import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFeishuCatalogImport,
  extractSheetIdFromUrl,
  extractWikiToken,
  mergeFeishuImportBooks,
  parseFeishuImportRows,
  pickFeishuCatalogSheets
} from "./feishu-novel-import.js";

test("reads wiki token and sheet id from the shared copy url", () => {
  const url = "https://my.feishu.cn/wiki/DMPvw98Wri5WCfk9wkScDrV1nce?sheet=acDhJT";
  assert.equal(extractWikiToken(url), "DMPvw98Wri5WCfk9wkScDrV1nce");
  assert.equal(extractSheetIdFromUrl(url), "acDhJT");
});

test("parses Feishu catalog fields without treating book id as search term", () => {
  const parsed = parseFeishuImportRows([
    ["上架日期", "书籍id", "英文书名", "爆款指数", "频道", "小说卖点", "备注", "推荐理由"],
    ["2026-08-01", "6283956923", "The Last Vow", "9.8", "女频", "虐恋逆袭", "强推", "这是一段足够长的免费开头，用来导入对应小说的免费内容。"]
  ], { sheetId: "acDhJT", sheetTitle: "🔥历史爆款" });
  assert.equal(parsed.books.length, 1);
  assert.equal(parsed.books[0].title, "The Last Vow");
  assert.equal(parsed.books[0].bookId, "6283956923");
  assert.equal(parsed.books[0].category, "女频");
  assert.equal(parsed.books[0].sellingPoint, "虐恋逆袭");
  assert.equal(parsed.books[0].note, "强推");
  assert.equal(parsed.books[0].featured, false);
  assert.equal(parsed.books[0].date, "2026-08-01");
  assert.match(parsed.books[0].sourceContent, /^这是一段足够长的免费开头/);
  assert.equal(parsed.books[0].searchTerm, undefined);
});

test("marks 重点书单 rows as featured", () => {
  const parsed = parseFeishuImportRows([
    ["日期", "英文书名", "英文书ID", "频道", "小说卖点", "备注", "推荐理由"],
    ["2026-07-16", "House of Lies", "111", "女频", "背叛", "置顶", "This free chapter is long enough to import into the catalog."]
  ], { sheetTitle: "重点书单" });
  assert.equal(parsed.books[0].featured, true);
  assert.equal(parsed.books[0].title, "House of Lies");
  assert.equal(parsed.books[0].bookId, "111");
});

test("skips existing titles and creates missing novels without promotion codes", () => {
  const result = applyFeishuCatalogImport(
    [{ id: "n1", title: "The Last Vow", promotionCode: "keep-me", sourceContent: "old content that is long enough", promotionCopy: "old" }],
    [
      { title: "The Last Vow", bookId: "6283956923", category: "女频", sourceContent: "飞书里的短推荐理由不应该覆盖已有书。" },
      { title: "New English Title", bookId: "3891249322", category: "男频", sellingPoint: "复仇", note: "可做", featured: true, date: "2026-08-02", sourceContent: "这是一本新书的免费开头。" }
    ],
    { now: "2026-08-19T04:00:00.000Z", createId: () => "novel-new" }
  );
  assert.equal(result.created, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.novels[0].promotionCode, "keep-me");
  assert.equal(result.novels[0].bookId, "6283956923");
  assert.equal(result.novels[0].sourceContent, "old content that is long enough");
  assert.equal(result.novels[1].id, "novel-new");
  assert.equal(result.novels[1].bookId, "3891249322");
  assert.equal(result.novels[1].title, "New English Title");
  assert.equal(result.novels[1].platform, "NovelMaster");
  assert.equal(result.novels[1].promotionCode, "");
  assert.equal(result.novels[1].promotionCopy, "");
  assert.equal(result.novels[1].featured, true);
  assert.equal(result.novels[1].category, "男频");
  assert.equal(result.novels[1].sellingPoint, "复仇");
  assert.equal(result.novels[1].note, "可做");
  assert.equal(result.novels[1].createdAt, "2026-08-02T00:00:00.000Z");
});

test("merges the same title from both sheets into one new novel", () => {
  const merged = mergeFeishuImportBooks([
    { title: "Shared Book", featured: true, category: "女频", sourceContent: "短", sellingPoint: "卖点A" },
    { title: "Shared Book", featured: false, category: "", sourceContent: "更长的推荐理由应该留下", sellingPoint: "", note: "备注" }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].featured, true);
  assert.equal(merged[0].sourceContent, "更长的推荐理由应该留下");
  assert.equal(merged[0].note, "备注");
});

test("picks featured and hit sheets together", () => {
  const sheets = pickFeishuCatalogSheets([
    { id: "1UEIdJ", title: "全书库" },
    { id: "4456fd", title: "重点书单" },
    { id: "acDhJT", title: "🔥历史爆款" }
  ]);
  assert.deepEqual(sheets.map((sheet) => sheet.id), ["4456fd", "acDhJT"]);
});
