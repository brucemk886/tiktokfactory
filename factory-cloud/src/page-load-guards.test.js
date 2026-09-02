import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { listNovelScripts, writeScripts } from "./novel-store.js";
import { listPublishRecords, mergeAndStorePublishRecords } from "./publish-records-store.js";

function memoryDb() {
  const kv = new Map();
  const scripts = new Map();
  const records = new Map();
  const statement = (sql, binds = []) => ({
    binds,
    bind(...values) {
      return statement(sql, values);
    },
    async first() {
      if (sql.includes("FROM factory_kv")) {
        const value = kv.get(binds[0]);
        return value == null ? null : { value_json: JSON.stringify(value) };
      }
      if (sql.includes("COUNT(*)") && sql.includes("factory_novel_scripts")) return { n: scripts.size };
      if (sql.includes("COUNT(*)") && sql.includes("factory_publish_records")) return { n: records.size };
      if (sql.includes("SELECT 1 FROM factory_novel_scripts") || sql.includes("SELECT 1 FROM factory_publish_records")) {
        return { ok: 1 };
      }
      return null;
    },
    async all() {
      if (sql.includes("FROM factory_novel_scripts") && sql.includes("value_json")) {
        const wanted = new Set(binds.map(String));
        const rows = [...scripts.values()].filter((script) => {
          if (!wanted.size) return !sql.includes("WHERE") || sql.includes("novel_id = ''");
          const novelId = String(script.novelId || "");
          return wanted.has(novelId) || (sql.includes("novel_id = ''") && !novelId);
        });
        return { results: rows.map((item) => ({ value_json: JSON.stringify(item) })) };
      }
      if (sql.includes("SELECT id FROM factory_novel_scripts")) {
        return { results: [...scripts.keys()].map((id) => ({ id })) };
      }
      if (sql.includes("FROM factory_publish_records") && sql.includes("value_json")) {
        const since = Number(binds[0] || 0);
        const limit = Number(binds[1] || 800);
        return {
          results: [...records.values()]
            .filter((record) => Number(record.createdAt || 0) >= since)
            .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
            .slice(0, limit)
            .map((record) => ({ value_json: JSON.stringify(record) })),
        };
      }
      if (sql.includes("SELECT id FROM factory_publish_records")) {
        return { results: [...records.keys()].map((id) => ({ id })) };
      }
      return { results: [] };
    },
    async run() {
      if (sql.includes("INSERT INTO factory_kv")) {
        kv.set(binds[0], JSON.parse(binds[1]));
        return { meta: { changes: 1 } };
      }
      if (sql.includes("INSERT INTO factory_novel_scripts")) {
        scripts.set(binds[0], JSON.parse(binds[3]));
        return { meta: { changes: 1 } };
      }
      if (sql.includes("DELETE FROM factory_novel_scripts")) {
        for (const id of binds) scripts.delete(String(id));
        return { meta: { changes: binds.length } };
      }
      if (sql.includes("INSERT INTO factory_publish_records")) {
        records.set(binds[0], JSON.parse(binds[2]));
        return { meta: { changes: 1 } };
      }
      if (sql.includes("DELETE FROM factory_publish_records")) {
        for (const id of binds) records.delete(String(id));
        return { meta: { changes: binds.length } };
      }
      return { meta: { changes: 0 } };
    },
  });
  return {
    prepare(sql) {
      return statement(sql);
    },
    async batch(items) {
      for (const item of items) await item.run();
      return items;
    },
  };
}

test("novel scripts migrate off the kv blob and can be read by novel id", async () => {
  const db = memoryDb();
  await writeScripts(db, [
    { id: "s1", novelId: "n1", title: "A", text: "long-text-1" },
    { id: "s2", novelId: "n2", title: "B", text: "long-text-2" },
    { id: "s3", novelId: "", title: "loose" },
  ]);
  const working = await listNovelScripts(db, { novelIds: ["n1"], includeUnassigned: true });
  assert.deepEqual(working.map((item) => item.id).sort(), ["s1", "s3"]);
  const one = await listNovelScripts(db, { novelIds: ["n2"] });
  assert.equal(one.length, 1);
  assert.equal(one[0].id, "s2");
});

test("publish records keep range reads off the 1mb kv blob", async () => {
  const db = memoryDb();
  const now = Date.now();
  await mergeAndStorePublishRecords(db, [
    { id: "old", createdAt: now - 20 * 86400000, status: "published", videoId: "v1" },
    { id: "fresh", createdAt: now - 3600000, status: "submitted", batchId: "11111111-1111-4111-8111-111111111111" },
  ]);
  const week = await listPublishRecords(db, { from: now - 7 * 86400000, limit: 50 });
  assert.equal(week.length, 1);
  assert.equal(week[0].id, "fresh");
});

test("factory page-open paths no longer persist ops snapshots or refresh archives on GET", async () => {
  const root = new URL("./", import.meta.url);
  const [official, novels, jobs] = await Promise.all([
    readFile(new URL("official.js", root), "utf8"),
    readFile(new URL("novels.js", root), "utf8"),
    readFile(new URL("jobs.js", root), "utf8"),
  ]);
  assert.doesNotMatch(official, /persistProjectOpsSnapshots/);
  assert.match(official, /listPublishRecords/);
  assert.match(novels, /workingOnly: true/);
  assert.match(novels, /listNovelScripts\(db, \{ novelIds: \[novel\.id\] \}\)/);
  assert.match(novels, /5 \* 60_000/);
  assert.match(jobs, /mergeAndStorePublishRecords/);
  assert.doesNotMatch(jobs, /kvGet\(env\.DB, "official-publish-records"/);
});
