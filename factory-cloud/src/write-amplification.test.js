import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compactAutoTask, getAutoTask, listAutoTasks, saveAutoTask, saveAutoTasks } from "./auto-tasks-store.js";
import { listPublishRecords, mergeAndStorePublishRecords, prunePublishRecords } from "./publish-records-store.js";

// Minimal D1 stand-in that records how many rows each call writes.
function memoryDb() {
  const kv = new Map();
  const records = new Map();
  const tasks = new Map();
  const stats = { writes: 0, deletes: 0, counts: 0 };
  const statement = (sql) => ({
    bind(...binds) {
      return { ...statement(sql), binds };
    },
    binds: [],
    async first() {
      const binds = this.binds;
      if (sql.includes("FROM factory_kv")) {
        const value = kv.get(binds[0]);
        return value === undefined ? null : { value_json: JSON.stringify(value) };
      }
      if (sql.includes("COUNT(*) AS n FROM factory_publish_records")) {
        stats.counts += 1;
        return { n: records.size };
      }
      if (sql.includes("COUNT(*) AS n FROM factory_auto_tasks")) return { n: tasks.size };
      if (sql.includes("FROM factory_auto_tasks WHERE id = ?")) {
        const row = tasks.get(binds[0]);
        return row ? { value_json: JSON.stringify(row.value) } : null;
      }
      return null;
    },
    async all() {
      const binds = this.binds;
      if (sql.includes("FROM factory_publish_records WHERE id IN")) {
        return {
          results: binds.filter((id) => records.has(id)).map((id) => ({
            id,
            created_at: records.get(id).created_at,
            value_json: JSON.stringify(records.get(id).value)
          }))
        };
      }
      if (sql.includes("FROM factory_publish_records WHERE created_at >= ?")) {
        const rows = [...records.values()].filter((row) => row.created_at >= binds[0]).sort((a, b) => b.created_at - a.created_at);
        return { results: rows.slice(0, binds[1]).map((row) => ({ value_json: JSON.stringify(row.value) })) };
      }
      if (sql.includes("FROM factory_auto_tasks")) {
        const rows = [...tasks.values()]
          .filter((row) => sql.includes("WHERE deleted = 0") ? !row.deleted : true)
          .sort((a, b) => b.created_at - a.created_at);
        return { results: rows.slice(0, binds[0]).map((row) => ({ value_json: JSON.stringify(row.value) })) };
      }
      return { results: [] };
    },
    async run() {
      const binds = this.binds;
      if (sql.includes("INSERT INTO factory_kv")) {
        kv.set(binds[0], JSON.parse(binds[1]));
        return { meta: { changes: 1 } };
      }
      if (sql.includes("INSERT INTO factory_publish_records")) {
        stats.writes += 1;
        records.set(binds[0], { created_at: binds[1], value: JSON.parse(binds[2]) });
        return { meta: { changes: 1 } };
      }
      if (sql.includes("DELETE FROM factory_publish_records WHERE created_at < ?")) {
        const drop = [...records.entries()].filter(([, row]) => row.created_at < binds[0]).map(([id]) => id);
        for (const id of drop) records.delete(id);
        stats.deletes += drop.length;
        return { meta: { changes: drop.length } };
      }
      if (sql.includes("INSERT INTO factory_auto_tasks")) {
        stats.writes += 1;
        tasks.set(binds[0], { deleted: binds[2], created_at: binds[3], value: JSON.parse(binds[5]) });
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
  });
  return {
    stats,
    kv,
    prepare(sql) {
      return statement(sql);
    },
    async batch(items) {
      for (const item of items) await item.run();
      return items;
    }
  };
}

test("re-sending the same publish records writes nothing", async () => {
  const db = memoryDb();
  const now = Date.now();
  const incoming = [
    { id: "a", createdAt: now - 3600000, status: "submitted", batchId: "11111111-1111-4111-8111-111111111111", note: "x" },
    { id: "b", createdAt: now - 1800000, status: "published", videoId: "v2" }
  ];
  const first = await mergeAndStorePublishRecords(db, incoming);
  assert.equal(first.written, 2);
  assert.equal(first.inserted, 2);

  const second = await mergeAndStorePublishRecords(db, incoming);
  assert.equal(second.received, 2);
  assert.equal(second.written, 0);
  assert.equal(db.stats.writes, 2);

  // Only the record whose content changed gets rewritten, and existing fields survive the merge.
  const third = await mergeAndStorePublishRecords(db, [{ id: "a", createdAt: now - 3600000, status: "published", videoId: "v1" }]);
  assert.equal(third.written, 1);
  assert.equal(db.stats.writes, 3);
  const stored = await listPublishRecords(db, { from: 0, limit: 10 });
  const a = stored.find((item) => item.id === "a");
  assert.equal(a.status, "published");
  assert.equal(a.videoId, "v1");
  assert.equal(a.note, "x");
  assert.equal(a.batchId, "11111111-1111-4111-8111-111111111111");
});

test("worker syncs never count or trim the publish records table; retention prunes by age", async () => {
  const db = memoryDb();
  const now = Date.now();
  await mergeAndStorePublishRecords(db, [
    { id: "ancient", createdAt: now - 120 * 86400000, status: "published" },
    { id: "mid", createdAt: now - 2 * 86400000, status: "published" }
  ]);
  const result = await mergeAndStorePublishRecords(db, [{ id: "new", createdAt: now, status: "submitted" }]);
  assert.equal(result.trimmed, 0);
  assert.equal(db.stats.deletes, 0);
  assert.equal(db.stats.counts, 0);
  const pruned = await prunePublishRecords(db, now);
  assert.equal(pruned.deletedRecords, 1);
  const kept = (await listPublishRecords(db, { from: 0, limit: 10 })).map((item) => item.id).sort();
  assert.deepEqual(kept, ["mid", "new"]);
});

test("auto tasks live in their own rows and migrate off the kv blob once", async () => {
  const db = memoryDb();
  const now = Date.now();
  db.kv.set("auto-tasks", [
    { id: "t2", status: "done", createdAt: now - 1000, updatedAt: now - 500, generatedVideos: Array.from({ length: 120 }, (_, i) => ({ fileName: `${i}.mp4`, extra: "drop" })) },
    { id: "t1", status: "deleted", deleted: 1, createdAt: now - 2000, updatedAt: now - 2000 }
  ]);
  const live = await listAutoTasks(db);
  assert.deepEqual(live.map((task) => task.id), ["t2"]);
  assert.equal(live[0].generatedVideos.length, 80);
  assert.equal(live[0].generatedVideos[0].extra, undefined);
  assert.deepEqual(db.kv.get("auto-tasks"), []);
  assert.equal((await listAutoTasks(db, { includeDeleted: true })).length, 2);

  const before = db.stats.writes;
  const task = await getAutoTask(db, "t2");
  await saveAutoTask(db, { ...task, progress: { current: 3, total: 10, percent: 30 }, updatedAt: now });
  assert.equal(db.stats.writes, before + 1);
  assert.equal((await getAutoTask(db, "t2")).progress.current, 3);

  await saveAutoTasks(db, [{ id: "t3", status: "queued", createdAt: now + 1, updatedAt: now + 1 }]);
  assert.deepEqual((await listAutoTasks(db)).map((task) => task.id), ["t3", "t2"]);
  assert.equal(compactAutoTask({ id: "x", officialPublishRecords: [1] }).officialPublishRecords, undefined);
});

test("cloud routes no longer touch the auto-tasks kv blob", async () => {
  const root = new URL("./", import.meta.url);
  const [compat, jobs, worker] = await Promise.all([
    readFile(new URL("compat.js", root), "utf8"),
    readFile(new URL("jobs.js", root), "utf8"),
    readFile(new URL("../../scripts/factory-cloud-worker.js", root), "utf8")
  ]);
  assert.doesNotMatch(compat, /"auto-tasks"/);
  assert.doesNotMatch(jobs, /"auto-tasks"/);
  assert.doesNotMatch(jobs, /compactAutoTasks/);
  assert.match(compat, /getJobsByIds\(db, tasks\.map/);
  assert.match(jobs, /saveAutoTasks\(env\.DB, changed\)/);
  assert.doesNotMatch(jobs, /mergeAndStorePublishRecords\(env\.DB, incoming, \{ limit/);
  assert.match(worker, /recordsChangedSince\(readOfficialPublishRecords/);
  assert.match(worker, /syncOfficialPublishRecordsIfEnabled/);
  assert.match(jobs, /publish-records\/sync/);
});
