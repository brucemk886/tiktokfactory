import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPublishReceipt,
  mergeAndStorePublishRecords,
  publishRecordRefs,
  receiptFromWebhookPayload,
  resetPublishReceiptTableCache,
} from "./publish-records-store.js";
import { ensurePublishWebhook, ensurePublishWebhookLazily, handlePublishWebhook, verifyPublishWebhookSignature } from "./publish-webhook.js";
import { archiveMetaDelta } from "./official-archive-store.js";

// In-memory stand-in for the four tables the receipt path touches.
function fakeDb() {
  const kv = new Map([["official-settings", { baseUrl: "https://desk.test", apiKey: "bridge-key", webhookSecret: "whsec_test" }]]);
  const records = new Map();
  const refs = new Map();
  const receipts = new Map();
  const log = [];
  const statement = (sql) => ({
    binds: [],
    bind(...binds) { return { ...statement(sql), binds }; },
    async first() {
      const b = this.binds;
      if (sql.includes("FROM factory_kv")) {
        const value = kv.get(b[0]);
        return value === undefined ? null : { value_json: JSON.stringify(value) };
      }
      if (sql.includes("SELECT 1 FROM factory_publish_records")) return { 1: 1 };
      if (sql.includes("SELECT 1 FROM factory_publish_receipts")) return { 1: 1 };
      if (sql.includes("SELECT 1 FROM factory_publish_record_refs")) return { 1: 1 };
      if (sql.includes("COUNT(*) AS n FROM factory_publish_records")) return { n: records.size };
      if (sql.includes("SELECT record_id FROM factory_publish_record_refs")) {
        for (const ref of b) if (refs.has(ref)) return { record_id: refs.get(ref) };
        return null;
      }
      if (sql.includes("value_json LIKE")) {
        const patterns = b.slice(1).map((p) => p.replace(/^%|%$/g, ""));
        for (const row of records.values()) if (patterns.some((p) => row.value_json.includes(p))) return { id: row.id };
        return null;
      }
      if (sql.includes("FROM factory_publish_receipts") && sql.includes("SUM(")) return { pending: 0, applied_24h: 0, received_24h: 0 };
      return null;
    },
    async all() {
      const b = this.binds;
      if (sql.includes("FROM factory_publish_records WHERE id IN")) {
        return { results: b.filter((id) => records.has(id)).map((id) => records.get(id)) };
      }
      if (sql.includes("FROM factory_publish_receipts WHERE applied_at = 0 AND ref IN")) {
        return { results: b.filter((ref) => receipts.has(ref) && !receipts.get(ref).applied_at).map((ref) => receipts.get(ref)) };
      }
      if (sql.includes("FROM factory_publish_receipts WHERE applied_at = 0 AND external_ref IN")) {
        return { results: [...receipts.values()].filter((row) => !row.applied_at && b.includes(row.external_ref)) };
      }
      return { results: [] };
    },
    async run() {
      const b = this.binds;
      log.push({ sql, binds: b });
      if (sql.includes("INSERT INTO factory_kv")) kv.set(b[0], JSON.parse(b[1]));
      else if (sql.includes("INSERT INTO factory_publish_records")) records.set(b[0], { id: b[0], created_at: b[1], value_json: b[2] });
      else if (sql.includes("INSERT INTO factory_publish_record_refs")) refs.set(b[0], b[1]);
      else if (sql.includes("INSERT INTO factory_publish_receipts")) {
        receipts.set(b[0], { ref: b[0], external_ref: b[1], batch_id: b[2], event_type: b[3], payload_json: b[4], received_at: b[5], applied_at: 0, record_id: "" });
      } else if (sql.includes("UPDATE factory_publish_receipts SET applied_at")) {
        const row = receipts.get(b[2]);
        if (row) { row.applied_at = b[0]; row.record_id = b[1]; }
      }
      return { meta: { changes: 1 } };
    }
  });
  return { kv, records, refs, receipts, log, prepare: statement, async batch(statements) { return Promise.all(statements.map((item) => item.run())); } };
}

async function signedRequest(secret, payload, { timestamp = Math.floor(Date.now() / 1000), tamper = false } = {}) {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
  const signature = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request("https://factory.test/api/integrations/signal-desk/publish-events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-signal-timestamp": String(timestamp), "x-signal-signature": `v1=${tamper ? "00" + signature.slice(2) : signature}` },
    body,
  });
}

const record = (overrides = {}) => ({
  id: "task-records:official:0:conn-1",
  provider: "official",
  source: "official-tiktok",
  status: "submitted",
  connectionId: "conn-1",
  fileName: "clip.mp4",
  externalRef: "clip.mp4:conn-1:0",
  remoteTaskId: "task-1",
  createdAt: Date.now() - 60_000,
  ...overrides,
});

test("record writes maintain the task/externalRef index", async () => {
  resetPublishReceiptTableCache();
  const db = fakeDb();
  assert.deepEqual(publishRecordRefs(record()), ["task:task-1", "ref:clip.mp4:conn-1:0"]);
  await mergeAndStorePublishRecords(db, [record()]);
  assert.equal(db.refs.get("task:task-1"), "task-records:official:0:conn-1");
  assert.equal(db.refs.get("ref:clip.mp4:conn-1:0"), "task-records:official:0:conn-1");
});

test("a signed publish.completed receipt marks the record published in one pass", async () => {
  resetPublishReceiptTableCache();
  const db = fakeDb();
  await mergeAndStorePublishRecords(db, [record()]);
  const payload = { id: "evt-1", type: "publish.completed", batchId: "batch-1", task: { id: "task-1", externalRef: "clip.mp4:conn-1:0", connectionId: "conn-1", fileName: "clip.mp4", status: "published", videoId: "7000000000000000001", videoUrl: "https://www.tiktok.com/@demo/video/7000000000000000001", error: "" } };
  const result = await handlePublishWebhook(await signedRequest("whsec_test", payload), {}, db);
  assert.equal(result.status, 200);
  assert.equal(result.body.applied, true);
  const stored = JSON.parse(db.records.get("task-records:official:0:conn-1").value_json);
  assert.equal(stored.status, "published");
  assert.equal(stored.videoId, "7000000000000000001");
  assert.match(stored.note, /已确认发布成功/);
  assert.deepEqual(stored.officialBatchIds.includes("batch-1"), true);
  assert.equal(db.receipts.get("task:task-1").applied_at > 0, true);
  assert.equal(db.kv.get("official-settings").webhookLastReceiptAt > 0, true);
});

test("bad signatures, stale timestamps and missing secrets are rejected", async () => {
  resetPublishReceiptTableCache();
  const db = fakeDb();
  const payload = { type: "publish.failed", task: { id: "task-9", status: "failed" } };
  assert.equal((await handlePublishWebhook(await signedRequest("wrong", payload), {}, db)).status, 401);
  assert.equal((await handlePublishWebhook(await signedRequest("whsec_test", payload, { tamper: true }), {}, db)).status, 401);
  assert.equal((await handlePublishWebhook(await signedRequest("whsec_test", payload, { timestamp: Math.floor(Date.now() / 1000) - 3600 }), {}, db)).status, 401);
  const ok = await signedRequest("whsec_test", payload);
  assert.equal(await verifyPublishWebhookSignature(ok.clone(), JSON.stringify(payload), "whsec_test"), true);
  db.kv.set("official-settings", { apiKey: "bridge-key" });
  assert.equal((await handlePublishWebhook(await signedRequest("whsec_test", payload), {}, db)).status, 503);
});

test("a stale local re-upload cannot undo a receipt outcome", async () => {
  resetPublishReceiptTableCache();
  const db = fakeDb();
  await mergeAndStorePublishRecords(db, [record()]);
  const receipt = receiptFromWebhookPayload({ type: "publish.completed", batchId: "batch-1", task: { id: "task-1", externalRef: "clip.mp4:conn-1:0", status: "published", videoId: "7000000000000000009" } });
  assert.equal((await applyPublishReceipt(db, receipt)).applied, true);
  const result = await mergeAndStorePublishRecords(db, [record({ status: "submitted", updatedAt: Date.now() })]);
  const stored = JSON.parse(db.records.get("task-records:official:0:conn-1").value_json);
  assert.equal(stored.status, "published");
  assert.equal(stored.videoId, "7000000000000000009");
  assert.equal(result.receiptsApplied, 0);
});

test("receipts that arrive before the record are applied by the next record sync", async () => {
  resetPublishReceiptTableCache();
  const db = fakeDb();
  const receipt = receiptFromWebhookPayload({ type: "publish.failed", batchId: "batch-2", task: { id: "task-2", externalRef: "late.mp4:conn-2:0", status: "failed", error: "spam_risk" } });
  const early = await applyPublishReceipt(db, receipt);
  assert.equal(early.stored, true);
  assert.equal(early.applied, false);
  assert.equal(db.receipts.get("task:task-2").applied_at, 0);

  const result = await mergeAndStorePublishRecords(db, [record({ id: "late-record", remoteTaskId: "", externalRef: "late.mp4:conn-2:0", connectionId: "conn-2", fileName: "late.mp4" })]);
  assert.equal(result.receiptsApplied, 1);
  const stored = JSON.parse(db.records.get("late-record").value_json);
  assert.equal(stored.status, "failed");
  assert.equal(stored.remoteTaskId, "task-2");
  assert.match(stored.note, /TikTok 拒绝/);
  assert.equal(db.receipts.get("task:task-2").applied_at > 0, true);
  assert.equal(db.receipts.get("task:task-2").record_id, "late-record");
});

test("factory registers itself with the hub and keeps the secret in settings", async () => {
  const db = fakeDb();
  db.kv.set("official-settings", { baseUrl: "https://desk.test", apiKey: "bridge-key" });
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "ep-1", secret: "whsec_new", replaced: 1 }), { status: 201, headers: { "content-type": "application/json" } });
  };
  try {
    const first = await ensurePublishWebhook({ FACTORY_PUBLIC_BASE_URL: "https://factory.test" }, db);
    assert.equal(first.changed, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://desk.test/api/v1/webhooks");
    assert.equal(calls[0].init.headers.Authorization, "Bearer bridge-key");
    assert.deepEqual(JSON.parse(calls[0].init.body), { name: "tiktok-factory", url: "https://factory.test/api/integrations/signal-desk/publish-events", events: ["publish.completed", "publish.failed"] });
    const settings = db.kv.get("official-settings");
    assert.equal(settings.webhookSecret, "whsec_new");
    assert.equal(settings.webhookEndpointId, "ep-1");
    assert.equal(settings.apiKey, "bridge-key");
    const second = await ensurePublishWebhook({ FACTORY_PUBLIC_BASE_URL: "https://factory.test" }, db);
    assert.equal(second.changed, false);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("lazy registration backs off for an hour after a hub failure and stops once registered", async () => {
  const db = fakeDb();
  db.kv.set("official-settings", { baseUrl: "https://desk.test", apiKey: "bridge-key" });
  let calls = 0;
  let respondOk = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    if (!respondOk) return new Response(JSON.stringify({ error: "down" }), { status: 503, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ id: "ep-9", secret: "whsec_lazy" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const env = { FACTORY_PUBLIC_BASE_URL: "https://factory.test" };
  try {
    const t0 = Date.now();
    const failed = await ensurePublishWebhookLazily(env, db, { now: t0 });
    assert.equal(failed.ok, false);
    assert.equal(calls, 1);
    const backoff = await ensurePublishWebhookLazily(env, db, { now: t0 + 5 * 60_000 });
    assert.equal(backoff.reason, "backoff");
    assert.equal(calls, 1);
    respondOk = true;
    const ok = await ensurePublishWebhookLazily(env, db, { now: t0 + 61 * 60_000 });
    assert.equal(ok.registered, true);
    assert.equal(calls, 2);
    assert.equal(db.kv.get("official-settings").webhookSecret, "whsec_lazy");
    const settled = await ensurePublishWebhookLazily(env, db, { now: t0 + 62 * 60_000 });
    assert.equal(settled.changed, false);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("archive meta moves incrementally per push", () => {
  const previous = new Map([["tiktok:a", 10], ["tiktok:b", 4]]);
  const rows = [
    { account_key: "tiktok:a", video_count: 12, snapshot_date: "2026-09-03", synced_at: 200 },
    { account_key: "tiktok:b", video_count: 4, snapshot_date: "2026-09-02", synced_at: 150 },
    { account_key: "tiktok:c", video_count: 7, snapshot_date: "2026-09-03", synced_at: 210 },
  ];
  assert.deepEqual(archiveMetaDelta(rows, previous), { accountDelta: 1, videoDelta: 9, archiveDate: "2026-09-03", archiveAt: 210 });
});
