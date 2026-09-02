import assert from "node:assert/strict";
import test from "node:test";
import { getNovelRow, listNovelsMatchingPeerHits, listWorkingNovelSummaries, markNovelsIdle, markNovelsWorking, syncWorkingNovels, upsertNovel } from "./novel-store.js";

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

test("working summaries query only working books", async () => {
  let sql = "";
  const db = {
    prepare(text) {
      sql = text;
      return { all: async () => ({ results: [{ id: "n1", title: "One", platform: "NovelMaster", book_id: "1", working: 1 }] }) };
    }
  };
  const novels = await listWorkingNovelSummaries(db);
  assert.match(sql, /WHERE working = 1/);
  assert.equal(novels[0].working, true);
});

test("markNovelsWorking updates only given ids", async () => {
  let sql = "";
  let binds = [];
  const db = {
    prepare(text) {
      sql = text;
      return {
        bind(...args) {
          binds = args;
          return { run: async () => ({ meta: { changes: 2 } }) };
        }
      };
    }
  };
  assert.equal(await markNovelsWorking(db, ["a", "a", "b", ""]), 2);
  assert.match(sql, /SET working = 1/);
  assert.deepEqual(binds, ["a", "b"]);
});

test("markNovelsIdle updates only given ids", async () => {
  let sql = "";
  let binds = [];
  const db = {
    prepare(text) {
      sql = text;
      return {
        bind(...args) {
          binds = args;
          return { run: async () => ({ meta: { changes: 1 } }) };
        }
      };
    }
  };
  assert.equal(await markNovelsIdle(db, ["drop", "drop", ""]), 1);
  assert.match(sql, /SET working = 0/);
  assert.deepEqual(binds, ["drop"]);
});

test("syncWorkingNovels marks script books and unmarks empty working books", async () => {
  const sqls = [];
  const db = {
    prepare(text) {
      const call = { sql: text, binds: [] };
      sqls.push(call);
      return {
        bind(...args) {
          call.binds = args;
          return {
            run: async () => ({ meta: { changes: 1 } }),
            all: async () => ({ results: [{ id: "keep" }, { id: "drop" }] })
          };
        },
        run: async () => ({ meta: { changes: 0 } }),
        all: async () => ({ results: [{ id: "keep" }, { id: "drop" }] })
      };
    }
  };
  const result = await syncWorkingNovels(db, ["keep"], { unmarkMissing: true });
  assert.equal(result.marked, 1);
  assert.equal(result.unmarked, 1);
  assert.equal(sqls.some((item) => /featured = 0/.test(item.sql)), false);
  assert.equal(sqls.some((item) => /SET working = 1/.test(item.sql) && item.binds[0] === "keep"), true);
  assert.equal(sqls.some((item) => /SET working = 0/.test(item.sql) && item.binds[0] === "drop"), true);
});

test("syncWorkingNovels keeps idle books unless unmark is requested", async () => {
  const sqls = [];
  const db = {
    prepare(text) {
      sqls.push(text);
      return {
        bind() {
          return { run: async () => ({ meta: { changes: 1 } }) };
        },
        all: async () => ({ results: [{ id: "keep" }, { id: "drop" }] })
      };
    }
  };
  const result = await syncWorkingNovels(db, ["keep"]);
  assert.equal(result.unmarked, 0);
  assert.equal(sqls.some((sql) => /SET working = 0/.test(sql)), false);
});

test("syncWorkingNovels does not unmark when script store is missing", async () => {
  const sqls = [];
  const db = {
    prepare(text) {
      sqls.push(text);
      return {
        bind() {
          return { run: async () => ({ meta: { changes: 1 } }) };
        },
        all: async () => ({ results: [{ id: "keep" }] })
      };
    }
  };
  const result = await syncWorkingNovels(db, [], { unmarkMissing: false });
  assert.equal(result.unmarked, 0);
  assert.equal(sqls.some((sql) => /SET working = 0/.test(sql)), false);
});

test("upsert keeps an existing working flag when the incoming book is idle", async () => {
  const sqls = [];
  const db = {
    prepare(text) {
      sqls.push(text);
      return {
        bind() {
          return { run: async () => ({}) };
        }
      };
    }
  };
  await upsertNovel(db, { id: "n1", title: "One", createdAt: "t", updatedAt: "t" });
  assert.equal(sqls.some((sql) => /working = CASE WHEN factory_novels.working = 1 OR excluded.working = 1 THEN 1 ELSE 0 END/.test(sql)), true);
});
