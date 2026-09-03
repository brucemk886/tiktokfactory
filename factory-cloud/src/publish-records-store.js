import { kvGet, kvSet } from "./kv.js";
import { applyOfficialRemoteOutcome, mergeOfficialPublishRecords, normalizeOfficialPublishRecord, officialRecordTime } from "../../scripts/official-publish-records.js";

const TABLE = "factory_publish_records";
const REFS_TABLE = "factory_publish_record_refs";
const RECEIPTS_TABLE = "factory_publish_receipts";
const KV_KEY = "official-publish-records";
// Upper bound for a single list read and for the legacy KV blob fallback. The
// table itself is bounded by age (see prunePublishRecords), not by row count,
// so a 3000-post day no longer pushes the morning's records out by evening.
const STORE_LIMIT = 5000;
export const PUBLISH_RECORD_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
// D1 caps bound parameters per statement at 100.
const ID_CHUNK = 90;
const WRITE_CHUNK = 40;
// Records created before the ref index existed are found by a bounded scan.
const REF_FALLBACK_SCAN_MS = 2 * 24 * 60 * 60 * 1000;
const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async function hasPublishTable(db) {
  try {
    await db.prepare(`SELECT 1 FROM ${TABLE} LIMIT 1`).first();
    return true;
  } catch {
    return false;
  }
}

let receiptTablesChecked = null;
async function hasReceiptTables(db) {
  if (receiptTablesChecked !== null) return receiptTablesChecked;
  try {
    await db.prepare(`SELECT 1 FROM ${RECEIPTS_TABLE} LIMIT 1`).first();
    await db.prepare(`SELECT 1 FROM ${REFS_TABLE} LIMIT 1`).first();
    receiptTablesChecked = true;
  } catch {
    receiptTablesChecked = false;
  }
  return receiptTablesChecked;
}

export function resetPublishReceiptTableCache() {
  receiptTablesChecked = null;
}

function recordFromRow(row) {
  try {
    return normalizeOfficialPublishRecord(JSON.parse(row?.value_json || "{}"));
  } catch {
    return null;
  }
}

export function taskRef(taskId) {
  const id = String(taskId || "").trim();
  return id ? `task:${id}` : "";
}

export function externalRefKey(externalRef) {
  const ref = String(externalRef || "").trim();
  return ref ? `ref:${ref}` : "";
}

export function publishRecordRefs(record) {
  return [taskRef(record?.remoteTaskId), externalRefKey(record?.externalRef)].filter(Boolean);
}

// Once the table is known to hold rows the legacy KV migration is over for the
// life of this isolate; before that a LIMIT 1 probe replaces the old COUNT(*),
// which read the whole table on every worker sync and page load.
let publishTablePopulated = false;
export async function migratePublishRecordsFromKv(db) {
  if (publishTablePopulated) return 0;
  if (!await hasPublishTable(db)) return 0;
  const any = await db.prepare(`SELECT 1 AS present FROM ${TABLE} LIMIT 1`).first();
  if (any) {
    publishTablePopulated = true;
    return 0;
  }
  const stored = await kvGet(db, KV_KEY, []);
  const records = mergeOfficialPublishRecords([], stored).slice(0, STORE_LIMIT);
  if (!records.length) return 0;
  await upsertPublishRecordRows(db, records);
  await kvSet(db, KV_KEY, []);
  publishTablePopulated = true;
  return records.length;
}

async function upsertPublishRecordRows(db, records = []) {
  const items = (Array.isArray(records) ? records : []).map(normalizeOfficialPublishRecord).filter((item) => item?.id);
  const statement = db.prepare(`
    INSERT INTO ${TABLE} (id, created_at, value_json)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      created_at = excluded.created_at,
      value_json = excluded.value_json
  `);
  const withRefs = await hasReceiptTables(db);
  const refStatement = withRefs ? db.prepare(`
    INSERT INTO ${REFS_TABLE} (ref, record_id, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(ref) DO UPDATE SET record_id = excluded.record_id
  `) : null;
  for (let index = 0; index < items.length; index += WRITE_CHUNK) {
    const slice = items.slice(index, index + WRITE_CHUNK);
    const statements = [];
    for (const record of slice) {
      const createdAt = officialRecordTime(record);
      statements.push(statement.bind(record.id, createdAt, JSON.stringify(record)));
      if (refStatement) {
        for (const ref of publishRecordRefs(record)) statements.push(refStatement.bind(ref, record.id, createdAt));
      }
    }
    await db.batch(statements);
  }
  return items.length;
}

async function loadPublishRecordRowsByIds(db, ids = []) {
  const rows = new Map();
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const slice = ids.slice(index, index + ID_CHUNK);
    const { results } = await db.prepare(
      `SELECT id, created_at, value_json FROM ${TABLE} WHERE id IN (${slice.map(() => "?").join(", ")})`
    ).bind(...slice).all();
    for (const row of results || []) rows.set(String(row.id), row);
  }
  return rows;
}

// Nightly: drop records past retention together with their ref index rows.
// Runs off the created_at index, so it costs rows proportional to what it
// deletes rather than a COUNT(*) over the whole table on every worker sync.
export async function prunePublishRecords(db, now = Date.now(), retentionMs = PUBLISH_RECORD_RETENTION_MS) {
  if (!await hasPublishTable(db)) return { deletedRecords: 0, deletedRefs: 0 };
  const cutoff = now - retentionMs;
  let deletedRefs = 0;
  if (await hasReceiptTables(db)) {
    const refs = await db.prepare(`
      DELETE FROM ${REFS_TABLE}
      WHERE record_id IN (SELECT id FROM ${TABLE} WHERE created_at < ?)
    `).bind(cutoff).run();
    deletedRefs = Number(refs?.meta?.changes || 0);
  }
  const records = await db.prepare(`DELETE FROM ${TABLE} WHERE created_at < ?`).bind(cutoff).run();
  return { deletedRecords: Number(records?.meta?.changes || 0), deletedRefs };
}

export async function listPublishRecords(db, { from = 0, limit = 800 } = {}) {
  await migratePublishRecordsFromKv(db);
  const cap = Math.max(1, Math.min(Number(limit) || 800, STORE_LIMIT));
  const since = Math.max(0, Number(from) || 0);
  if (await hasPublishTable(db)) {
    const { results } = await db.prepare(
      `SELECT value_json FROM ${TABLE} WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`
    ).bind(since, cap).all();
    return (results || []).map(recordFromRow).filter(Boolean);
  }
  const stored = await kvGet(db, KV_KEY, []);
  return mergeOfficialPublishRecords([], stored)
    .filter((record) => officialRecordTime(record) >= since)
    .slice(0, cap);
}

// Only the incoming ids are read, and only records whose merged content differs
// from the stored row are written. The worker re-sends the same records every
// few minutes, so most calls end with zero rows written.
export async function mergeAndStorePublishRecords(db, incoming = [], { limit = STORE_LIMIT } = {}) {
  await migratePublishRecordsFromKv(db);
  const items = mergeOfficialPublishRecords([], incoming);
  if (!items.length) return { received: 0, written: 0, inserted: 0, trimmed: 0, receiptsApplied: 0 };
  if (!await hasPublishTable(db)) {
    const stored = await kvGet(db, KV_KEY, []);
    const merged = mergeOfficialPublishRecords(stored, items).slice(0, Math.max(1, Number(limit) || STORE_LIMIT));
    await kvSet(db, KV_KEY, merged);
    return { received: items.length, written: merged.length, inserted: 0, trimmed: 0, receiptsApplied: 0 };
  }

  const existing = await loadPublishRecordRowsByIds(db, items.map((item) => item.id));
  const pendingReceipts = await loadPendingReceiptsForRecords(db, items);
  const changed = [];
  const appliedReceiptRefs = [];
  let inserted = 0;
  for (const item of items) {
    const row = existing.get(item.id);
    const previous = row ? recordFromRow(row) : null;
    let merged = previous ? mergeOfficialPublishRecords([previous], [item])[0] : item;
    if (!merged) continue;
    if (previous) merged = keepReceiptOutcome(previous, item, merged);
    const receipt = pendingReceipts.get(taskRef(merged.remoteTaskId)) || pendingReceipts.get(externalRefKey(merged.externalRef));
    if (receipt) {
      merged = applyReceiptToRecord(merged, receipt);
      appliedReceiptRefs.push({ ref: receipt.ref, recordId: merged.id });
    }
    if (!row) {
      changed.push(merged);
      inserted += 1;
      continue;
    }
    if (previous && Number(row.created_at) === officialRecordTime(merged) && sameRecord(previous, merged)) continue;
    changed.push(merged);
  }
  if (changed.length) await upsertPublishRecordRows(db, changed);
  if (appliedReceiptRefs.length) await markReceiptsApplied(db, appliedReceiptRefs);
  return { received: items.length, written: changed.length, inserted, trimmed: 0, receiptsApplied: appliedReceiptRefs.length };
}

const RECEIPT_OUTCOME_FIELDS = ["status", "videoId", "shareLink", "videoUrl", "note", "publishError", "officialRemoteStatus", "receiptAt", "username", "accountUsername"];

// The local worker keeps re-sending its own copy, which may still say
// "submitted". A hub receipt is the authority on the outcome, so it wins over
// any incoming copy that carries no newer outcome of its own.
export function keepReceiptOutcome(previous, incoming, merged) {
  if (!previous?.receiptAt) return merged;
  const incomingHasOutcome = Boolean(String(incoming?.videoId || incoming?.tiktokVideoId || "").trim())
    || Number(incoming?.receiptAt) > Number(previous.receiptAt);
  if (incomingHasOutcome) return merged;
  const next = { ...merged };
  for (const field of RECEIPT_OUTCOME_FIELDS) {
    if (previous[field] !== undefined && previous[field] !== "") next[field] = previous[field];
  }
  return next;
}

// A hub webhook payload: { id, type, batchId, task: publicPublishTask }.
export function receiptFromWebhookPayload(payload, receivedAt = Date.now()) {
  const task = payload?.task && typeof payload.task === "object" ? payload.task : null;
  const taskId = String(task?.id || "").trim();
  if (!taskId) return null;
  return {
    ref: taskRef(taskId),
    taskId,
    externalRef: String(task?.externalRef || "").trim(),
    batchId: String(payload?.batchId || task?.batchId || "").trim(),
    eventType: String(payload?.type || "").trim(),
    task,
    receivedAt,
  };
}

export function applyReceiptToRecord(record, receipt) {
  const task = receipt?.task || {};
  const next = applyOfficialRemoteOutcome(record, task);
  const batchIds = Array.isArray(record.officialBatchIds) ? [...record.officialBatchIds] : [];
  if (receipt.batchId && !batchIds.includes(receipt.batchId)) batchIds.push(receipt.batchId);
  return {
    ...next,
    remoteTaskId: String(record.remoteTaskId || receipt.taskId || ""),
    externalRef: String(record.externalRef || receipt.externalRef || ""),
    batchId: String(record.batchId || receipt.batchId || ""),
    officialBatchIds: batchIds,
    receiptAt: Number(receipt.receivedAt) || Date.now(),
    updatedAt: Math.max(Number(record.updatedAt) || 0, Number(receipt.receivedAt) || Date.now()),
  };
}

// Stores the receipt and applies it to its record when the record is already
// known. Returns { stored, applied, recordId }.
export async function applyPublishReceipt(db, receipt) {
  if (!receipt?.ref) return { stored: false, applied: false, recordId: "" };
  if (!await hasReceiptTables(db)) return { stored: false, applied: false, recordId: "", reason: "receipt-tables-missing" };
  await db.prepare(`
    INSERT INTO ${RECEIPTS_TABLE} (ref, external_ref, batch_id, event_type, payload_json, received_at, applied_at, record_id)
    VALUES (?, ?, ?, ?, ?, ?, 0, '')
    ON CONFLICT(ref) DO UPDATE SET
      external_ref = excluded.external_ref,
      batch_id = excluded.batch_id,
      event_type = excluded.event_type,
      payload_json = excluded.payload_json,
      received_at = excluded.received_at,
      applied_at = 0
  `).bind(receipt.ref, receipt.externalRef, receipt.batchId, receipt.eventType, JSON.stringify(receipt.task || {}), receipt.receivedAt).run();

  const recordId = await resolveRecordIdForReceipt(db, receipt);
  if (!recordId) return { stored: true, applied: false, recordId: "" };
  const rows = await loadPublishRecordRowsByIds(db, [recordId]);
  const previous = rows.get(recordId) ? recordFromRow(rows.get(recordId)) : null;
  if (!previous) return { stored: true, applied: false, recordId: "" };
  const merged = applyReceiptToRecord(previous, receipt);
  await upsertPublishRecordRows(db, [merged]);
  await markReceiptsApplied(db, [{ ref: receipt.ref, recordId }]);
  return { stored: true, applied: true, recordId, status: merged.status };
}

async function resolveRecordIdForReceipt(db, receipt) {
  const refs = [receipt.ref, externalRefKey(receipt.externalRef)].filter(Boolean);
  const indexed = await db.prepare(
    `SELECT record_id FROM ${REFS_TABLE} WHERE ref IN (${refs.map(() => "?").join(", ")}) LIMIT 1`
  ).bind(...refs).first();
  if (indexed?.record_id) return String(indexed.record_id);
  // Fallback for rows written before the ref index existed.
  const patterns = [
    receipt.taskId ? `%"remoteTaskId":${JSON.stringify(receipt.taskId)}%` : "",
    receipt.externalRef ? `%"externalRef":${JSON.stringify(receipt.externalRef)}%` : "",
  ].filter(Boolean);
  if (!patterns.length) return "";
  const row = await db.prepare(`
    SELECT id FROM ${TABLE}
    WHERE created_at >= ? AND (${patterns.map(() => "value_json LIKE ?").join(" OR ")})
    ORDER BY created_at DESC LIMIT 1
  `).bind(Number(receipt.receivedAt || Date.now()) - REF_FALLBACK_SCAN_MS, ...patterns).first();
  return row?.id ? String(row.id) : "";
}

async function loadPendingReceiptsForRecords(db, items) {
  const found = new Map();
  if (!await hasReceiptTables(db)) return found;
  const refs = [];
  const externals = [];
  for (const item of items) {
    const ref = taskRef(item?.remoteTaskId);
    const external = String(item?.externalRef || "").trim();
    if (ref) refs.push(ref);
    if (external) externals.push(external);
  }
  const collect = (rows) => {
    for (const row of rows || []) {
      let task = {};
      try { task = JSON.parse(row.payload_json || "{}"); } catch { task = {}; }
      const receipt = {
        ref: String(row.ref),
        taskId: String(row.ref).replace(/^task:/, ""),
        externalRef: String(row.external_ref || ""),
        batchId: String(row.batch_id || ""),
        eventType: String(row.event_type || ""),
        task,
        receivedAt: Number(row.received_at) || 0,
      };
      found.set(receipt.ref, receipt);
      if (receipt.externalRef) found.set(externalRefKey(receipt.externalRef), receipt);
    }
  };
  for (let index = 0; index < refs.length; index += ID_CHUNK) {
    const slice = refs.slice(index, index + ID_CHUNK);
    const { results } = await db.prepare(
      `SELECT ref, external_ref, batch_id, event_type, payload_json, received_at FROM ${RECEIPTS_TABLE} WHERE applied_at = 0 AND ref IN (${slice.map(() => "?").join(", ")})`
    ).bind(...slice).all();
    collect(results);
  }
  for (let index = 0; index < externals.length; index += ID_CHUNK) {
    const slice = externals.slice(index, index + ID_CHUNK);
    const { results } = await db.prepare(
      `SELECT ref, external_ref, batch_id, event_type, payload_json, received_at FROM ${RECEIPTS_TABLE} WHERE applied_at = 0 AND external_ref IN (${slice.map(() => "?").join(", ")})`
    ).bind(...slice).all();
    collect(results);
  }
  return found;
}

async function markReceiptsApplied(db, entries, now = Date.now()) {
  if (!entries.length || !await hasReceiptTables(db)) return;
  const statement = db.prepare(`UPDATE ${RECEIPTS_TABLE} SET applied_at = ?, record_id = ? WHERE ref = ?`);
  for (let index = 0; index < entries.length; index += WRITE_CHUNK) {
    await db.batch(entries.slice(index, index + WRITE_CHUNK).map((entry) => statement.bind(now, entry.recordId, entry.ref)));
  }
}

export async function publishReceiptStats(db, now = Date.now()) {
  if (!await hasReceiptTables(db)) return { available: false, pending: 0, applied24h: 0, received24h: 0 };
  const row = await db.prepare(`
    SELECT
      SUM(CASE WHEN applied_at = 0 THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN applied_at >= ? THEN 1 ELSE 0 END) AS applied_24h,
      SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) AS received_24h
    FROM ${RECEIPTS_TABLE}
    WHERE received_at >= ?
  `).bind(now - 86_400_000, now - 86_400_000, now - 7 * 86_400_000).first();
  return {
    available: true,
    pending: Number(row?.pending || 0),
    applied24h: Number(row?.applied_24h || 0),
    received24h: Number(row?.received_24h || 0),
  };
}

// Refs are not aged out here: they live exactly as long as their record (see
// prunePublishRecords), so a late receipt for an old record still resolves.
export async function prunePublishReceipts(db, now = Date.now()) {
  if (!await hasReceiptTables(db)) return { deletedReceipts: 0 };
  const cutoff = now - RECEIPT_RETENTION_MS;
  const receipts = await db.prepare(`DELETE FROM ${RECEIPTS_TABLE} WHERE received_at < ?`).bind(cutoff).run();
  return { deletedReceipts: Number(receipts?.meta?.changes || 0) };
}

function sameRecord(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}
