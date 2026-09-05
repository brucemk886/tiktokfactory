import assert from "node:assert/strict";
import test from "node:test";
import { applyOfficialRemoteOutcome } from "../../scripts/official-publish-records.js";
import { applySourcedPublishRecordEvents, keepReceiptOutcome, resetPublishRevisionTableCache } from "./publish-records-store.js";
import { validatePublishRecordSyncV2 } from "./publish-records-sync-v2.js";

function memoryDb({ missingRevisions = false } = {}) {
  const records = new Map();
  const revisions = new Map();
  const receipts = new Map();
  const refs = new Map();
  let failNextBatch = false;
  const statement = (sql) => ({
    bind(...binds) {
      return { ...statement(sql), binds };
    },
    binds: [],
    async first() {
      if (sql.includes("FROM factory_publish_source_revisions") && missingRevisions) throw new Error("no such table");
      if (sql.includes("FROM factory_publish_source_revisions LIMIT 1")) return { 1: 1 };
      if (sql.includes("FROM factory_publish_records LIMIT 1")) return records.size ? { 1: 1 } : null;
      if (sql.includes("FROM factory_publish_receipts LIMIT 1") || sql.includes("FROM factory_publish_record_refs LIMIT 1")) return { 1: 1 };
      return null;
    },
    async all() {
      const binds = this.binds;
      if (sql.includes("FROM factory_publish_records WHERE id IN")) {
        return {
          results: binds.filter((id) => records.has(id)).map((id) => ({
            id,
            created_at: records.get(id).created_at,
            value_json: JSON.stringify(records.get(id).value),
          })),
        };
      }
      if (sql.includes("FROM factory_publish_source_revisions")) {
        const source = binds[0];
        const keys = binds.slice(1);
        return {
          results: keys.filter((key) => revisions.has(`${source}|${key}`)).map((key) => {
            const row = revisions.get(`${source}|${key}`);
            return { record_key: key, applied_revision: row.revision, applied_seq: row.seq };
          }),
        };
      }
      if (sql.includes("FROM factory_publish_receipts")) return { results: [] };
      return { results: [] };
    },
    async run() {
      const binds = this.binds;
      if (sql.includes("INSERT INTO factory_publish_records")) {
        records.set(binds[0], { created_at: binds[1], value: JSON.parse(binds[2]) });
        return { meta: { changes: 1 } };
      }
      if (sql.includes("INSERT INTO factory_publish_source_revisions")) {
        revisions.set(`${binds[0]}|${binds[1]}`, { revision: binds[2], seq: binds[3] });
        return { meta: { changes: 1 } };
      }
      if (sql.includes("INSERT INTO factory_publish_record_refs")) {
        refs.set(binds[0], binds[1]);
        return { meta: { changes: 1 } };
      }
      if (sql.includes("UPDATE factory_publish_receipts")) {
        receipts.set(binds[2], { applied_at: binds[0], recordId: binds[1] });
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    },
  });
  return {
    records,
    revisions,
    failNextBatch() { failNextBatch = true; },
    prepare(sql) { return statement(sql); },
    async batch(items) {
      if (failNextBatch) {
        failNextBatch = false;
        throw new Error("D1 batch failed halfway");
      }
      const snapshot = {
        records: new Map([...records.entries()].map(([id, row]) => [id, { ...row, value: { ...row.value } }])),
        revisions: new Map(revisions),
      };
      try {
        for (const item of items) await item.run();
      } catch (error) {
        records.clear();
        for (const [id, row] of snapshot.records) records.set(id, row);
        revisions.clear();
        for (const [key, row] of snapshot.revisions) revisions.set(key, row);
        throw error;
      }
    },
  };
}

test("v2 validation checks page boundaries and rejects ordinary ok responses", () => {
  const events = [
    { seq: 2, recordRevision: 1, record: { id: "a", status: "submitted" } },
    { seq: 5, recordRevision: 2, record: { id: "b", status: "submitted" } },
  ];
  assert.equal(validatePublishRecordSyncV2({
    protocolVersion: 2,
    sourceStoreId: "src",
    workerId: "w1",
    afterSeq: 1,
    throughSeq: 5,
    events,
  }).ok, true);
  assert.equal(validatePublishRecordSyncV2({
    protocolVersion: 2,
    sourceStoreId: "src",
    workerId: "w1",
    afterSeq: 1,
    throughSeq: 4,
    events,
  }).ok, false);
  assert.equal(validatePublishRecordSyncV2({ ok: true }).ok, false);
});

test("v2 apply ignores older revisions and keeps receipt outcomes", async () => {
  resetPublishRevisionTableCache();
  const db = memoryDb();
  const first = await applySourcedPublishRecordEvents(db, {
    sourceStoreId: "src-a",
    events: [
      { seq: 1, recordRevision: 1, record: { id: "r1", status: "submitted", createdAt: 10, remoteTaskId: "t1" } },
      { seq: 2, recordRevision: 2, record: { id: "r1", status: "submitted", createdAt: 10, videoId: "v1" } },
    ],
  });
  assert.equal(first.applied, 1);
  db.records.get("r1").value.receiptAt = 99;
  db.records.get("r1").value.status = "published";
  db.records.get("r1").value.videoId = "v1";
  const ignored = await applySourcedPublishRecordEvents(db, {
    sourceStoreId: "src-a",
    events: [
      { seq: 3, recordRevision: 2, record: { id: "r1", status: "submitted", createdAt: 10 } },
    ],
  });
  assert.equal(ignored.ignored, 1);
  const merged = keepReceiptOutcome(
    { status: "published", videoId: "v1", receiptAt: 99, note: "ok" },
    { status: "submitted" },
    { status: "submitted", videoId: "v1", receiptAt: 99, note: "ok" },
  );
  assert.equal(merged.status, "published");
  const remote = applyOfficialRemoteOutcome({ status: "submitted" }, { status: "failed", error: "spam_risk" });
  assert.equal(remote.status, "failed");
});

test("missing revision table does not ACK and a failed batch rolls back", async () => {
  resetPublishRevisionTableCache();
  await assert.rejects(() => applySourcedPublishRecordEvents(memoryDb({ missingRevisions: true }), {
    sourceStoreId: "src-a",
    events: [{ seq: 1, recordRevision: 1, record: { id: "r1", status: "submitted", createdAt: 1 } }],
  }), /source_revisions/);
  resetPublishRevisionTableCache();
  const db = memoryDb();
  db.failNextBatch();
  await assert.rejects(() => applySourcedPublishRecordEvents(db, {
    sourceStoreId: "src-a",
    events: [{ seq: 1, recordRevision: 1, record: { id: "r1", status: "submitted", createdAt: 1 } }],
  }), /batch failed/);
  assert.equal(db.records.size, 0);
  assert.equal(db.revisions.size, 0);
});
