import assert from "node:assert/strict";
import test from "node:test";
import { pruneAutoTasks } from "./auto-tasks-store.js";
import { refreshOfficialArchive, readArchiveMeta } from "./official-archive-store.js";
import { signalDeskAllAccounts } from "./signal-desk.js";

// Tiny D1 stand-in: a kv map plus a log of every executed statement.
function fakeDb() {
  const kv = new Map([["official-settings", { baseUrl: "https://desk.test", apiKey: "k" }]]);
  const log = [];
  const statement = (sql) => ({
    binds: [],
    bind(...binds) { return { ...statement(sql), binds }; },
    async first() {
      if (sql.includes("FROM factory_kv")) {
        const value = kv.get(this.binds[0]);
        return value === undefined ? null : { value_json: JSON.stringify(value) };
      }
      if (sql.includes("FROM official_archive_meta")) return null;
      return null;
    },
    async all() { return { results: [] }; },
    async run() {
      log.push({ sql, binds: this.binds });
      if (sql.includes("INSERT INTO factory_kv")) kv.set(this.binds[0], JSON.parse(this.binds[1]));
      return { meta: { changes: 1 } };
    }
  });
  return {
    kv,
    log,
    prepare: statement,
    async batch(statements) { return Promise.all(statements.map((item) => item.run())); }
  };
}

function withFetch(pages, body) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const cursor = new URL(String(url)).searchParams.get("cursor") || "";
    const page = pages[cursor] || { accounts: [], hasMore: false, nextCursor: "" };
    return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
  };
  return body(calls).finally(() => { globalThis.fetch = original; });
}

test("archive refresh resumes from the saved cursor instead of restarting at page one", async () => {
  const db = fakeDb();
  const pages = {
    "": { accounts: [], hasMore: true, nextCursor: "c1" },
    c1: { accounts: [], hasMore: true, nextCursor: "c2" },
    c2: { accounts: [], hasMore: false, nextCursor: "" }
  };
  await withFetch(pages, async (calls) => {
    const first = await refreshOfficialArchive({}, db, { pagesPerRun: 2 });
    assert.equal(first.completed, false);
    assert.equal(first.resumeCursor, "c2");
    assert.deepEqual(calls.map((url) => new URL(url).searchParams.get("cursor") || ""), ["", "c1"]);
    assert.equal(db.kv.get("official-archive-refresh-cursor").cursor, "c2");

    calls.length = 0;
    const second = await refreshOfficialArchive({}, db, { pagesPerRun: 2 });
    assert.deepEqual(calls.map((url) => new URL(url).searchParams.get("cursor") || ""), ["c2"]);
    assert.equal(second.completed, true);
    assert.equal(db.kv.get("official-archive-refresh-cursor").cursor, "");
  });
});

test("signalDeskAllAccounts merges every page of /api/v1/accounts", async () => {
  const db = fakeDb();
  const pages = {
    "": { accounts: [{ connectionId: "a" }, { connectionId: "b" }], hasMore: true, nextCursor: "b" },
    b: { accounts: [{ connectionId: "c" }], hasMore: false, nextCursor: "" }
  };
  await withFetch(pages, async (calls) => {
    const merged = await signalDeskAllAccounts({}, db, { pageLimit: 2 });
    assert.deepEqual(merged.accounts.map((account) => account.connectionId), ["a", "b", "c"]);
    assert.equal(merged.hasMore, false);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /\/api\/v1\/accounts\?limit=2$/);
    assert.match(calls[1], /cursor=b/);
  });
});

test("nightly prune drops soft-deleted and long-finished auto tasks only", async () => {
  const db = fakeDb();
  const now = 1_000_000_000_000;
  const result = await pruneAutoTasks(db, { now, deletedKeepDays: 30, finishedKeepDays: 90 });
  assert.deepEqual(result, { deleted: 1, finished: 1 });
  const [deleted, finished] = db.log;
  assert.match(deleted.sql, /WHERE deleted = 1 AND updated_at < \?/);
  assert.equal(deleted.binds[0], now - 30 * 86_400_000);
  assert.match(finished.sql, /status IN \(\?, \?, \?, \?\) AND updated_at < \?/);
  assert.deepEqual(finished.binds.slice(0, 4), ["done", "failed", "canceled", "cancelled"]);
  assert.equal(finished.binds[4], now - 90 * 86_400_000);
  assert.equal(typeof readArchiveMeta, "function");
});
