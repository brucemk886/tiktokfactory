import assert from "node:assert/strict";
import test from "node:test";
import { getNovelRow, listNovelsMatchingPeerHits } from "./novel-store.js";

test("peer-hit matching does not scan the catalog when a hit has no book id or title", async () => {
  let prepared = 0;
  const db = {
    prepare() {
      prepared += 1;
      return { bind() { return { all: async () => ({ results: [] }) }; } };
    }
  };
  assert.deepEqual(await listNovelsMatchingPeerHits(db, [{ playCount: 9 }]), []);
  assert.equal(prepared, 0);
});

test("peer-hit matching queries only the submitted book ids", async () => {
  let sql = "";
  let binds = [];
  const db = {
    prepare(text) {
      sql = text;
      return {
        bind(...args) {
          binds = args;
          return {
            all: async () => ({ results: [{ id: "n1", title: "Alpha", platform: "NovelMaster", book_id: "111" }] })
          };
        }
      };
    }
  };
  const novels = await listNovelsMatchingPeerHits(db, [{ novelId: "111", novelTitle: "Alpha", platform: "NovelMaster" }]);
  assert.match(sql, /book_id IN/);
  assert.deepEqual(binds, ["111", "111", "Alpha"]);
  assert.equal(novels[0].bookId, "111");
  assert.equal(novels[0].platform, "NovelMaster");
});

test("getNovelRow reads one book by id", async () => {
  let sql = "";
  const db = {
    prepare(text) {
      sql = text;
      return {
        bind(id) {
          return {
            first: async () => ({
              id,
              title: "One",
              platform: "NovelMaster",
              book_id: "1",
              promotion_code: "",
              promotion_copy: "",
              category: "",
              featured: 0,
              selling_point: "",
              note: "",
              source_content: "chapter",
              status: "active",
              created_at: "t",
              updated_at: "t"
            })
          };
        }
      };
    }
  };
  const novel = await getNovelRow(db, "n1");
  assert.match(sql, /WHERE id = \?/);
  assert.equal(novel.id, "n1");
  assert.equal(novel.title, "One");
  assert.equal(await getNovelRow(db, ""), null);
});
