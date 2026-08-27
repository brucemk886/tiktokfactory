import assert from "node:assert/strict";
import test from "node:test";
import { listNovelsMatchingPeerHits } from "./novel-store.js";

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
