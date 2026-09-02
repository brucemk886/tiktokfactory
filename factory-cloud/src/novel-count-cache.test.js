import assert from "node:assert/strict";
import test from "node:test";
import { countNovels, deleteNovelRow, insertNovels, upsertNovel } from "./novel-store.js";

function mockCountDb({ kv = null, count = 7733 } = {}) {
  const store = { kv, count, countCalls: 0 };
  return {
    store,
    prepare(sql) {
      const statement = {
        binds: [],
        bind(...values) {
          statement.binds = values;
          return statement;
        },
        async first() {
          if (sql.includes("FROM factory_kv")) {
            return store.kv ? { value_json: JSON.stringify(store.kv) } : null;
          }
          if (sql.includes("COUNT(*)")) {
            store.countCalls += 1;
            return { n: store.count };
          }
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO factory_kv")) {
            store.kv = JSON.parse(statement.binds[1]);
            return { meta: { changes: 1 } };
          }
          if (sql.includes("DELETE FROM factory_kv")) {
            store.kv = null;
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO factory_novels") || sql.includes("DELETE FROM factory_novels")) {
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async all() {
          return { results: [] };
        }
      };
      return statement;
    },
    async batch() {
      return [];
    }
  };
}

test("countNovels caches the catalog size after the first full scan", async () => {
  const db = mockCountDb({ count: 7733 });
  assert.equal(await countNovels(db), 7733);
  assert.equal(await countNovels(db), 7733);
  assert.equal(db.store.countCalls, 1);
});

test("inserting or deleting a novel invalidates the cached count", async () => {
  const db = mockCountDb({ kv: { n: 10 }, count: 11 });
  assert.equal(await countNovels(db), 10);
  assert.equal(db.store.countCalls, 0);
  await upsertNovel(db, {
    id: "novel-1",
    title: "One",
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z"
  });
  assert.equal(await countNovels(db), 11);
  assert.equal(db.store.countCalls, 1);
  db.store.count = 10;
  await deleteNovelRow(db, "novel-1");
  assert.equal(await countNovels(db), 10);
  assert.equal(db.store.countCalls, 2);
});

test("insertNovels invalidates the cached count", async () => {
  const db = mockCountDb({ kv: { n: 2 }, count: 3 });
  await insertNovels(db, [{
    id: "novel-2",
    title: "Two",
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z"
  }]);
  assert.equal(await countNovels(db), 3);
  assert.equal(db.store.countCalls, 1);
});
