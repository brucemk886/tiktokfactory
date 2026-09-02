import { kvGet, kvSet } from "./kv.js";
import { mergeOfficialPublishRecords, normalizeOfficialPublishRecord, officialRecordTime } from "../../scripts/official-publish-records.js";

const TABLE = "factory_publish_records";
const KV_KEY = "official-publish-records";
const STORE_LIMIT = 3000;

async function hasPublishTable(db) {
  try {
    await db.prepare(`SELECT 1 FROM ${TABLE} LIMIT 1`).first();
    return true;
  } catch {
    return false;
  }
}

function recordFromRow(row) {
  try {
    return normalizeOfficialPublishRecord(JSON.parse(row?.value_json || "{}"));
  } catch {
    return null;
  }
}

export async function migratePublishRecordsFromKv(db) {
  if (!await hasPublishTable(db)) return 0;
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`).first();
  if (Number(count?.n || 0) > 0) return 0;
  const stored = await kvGet(db, KV_KEY, []);
  const records = mergeOfficialPublishRecords([], stored).slice(0, STORE_LIMIT);
  if (!records.length) return 0;
  await replacePublishRecordRows(db, records);
  await kvSet(db, KV_KEY, []);
  return records.length;
}

async function replacePublishRecordRows(db, records = []) {
  const items = (Array.isArray(records) ? records : []).map(normalizeOfficialPublishRecord).filter((item) => item?.id);
  const statement = db.prepare(`
    INSERT INTO ${TABLE} (id, created_at, value_json)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      created_at = excluded.created_at,
      value_json = excluded.value_json
  `);
  for (let index = 0; index < items.length; index += 40) {
    const slice = items.slice(index, index + 40);
    await db.batch(slice.map((record) => statement.bind(
      record.id,
      officialRecordTime(record),
      JSON.stringify(record)
    )));
  }
  const keep = new Set(items.map((record) => record.id));
  const { results } = await db.prepare(`SELECT id FROM ${TABLE}`).all();
  const drop = (results || []).map((row) => String(row.id || "")).filter((id) => id && !keep.has(id));
  for (let index = 0; index < drop.length; index += 40) {
    const slice = drop.slice(index, index + 40);
    await db.prepare(`DELETE FROM ${TABLE} WHERE id IN (${slice.map(() => "?").join(", ")})`).bind(...slice).run();
  }
  return items.length;
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

export async function mergeAndStorePublishRecords(db, incoming = [], { limit = STORE_LIMIT } = {}) {
  await migratePublishRecordsFromKv(db);
  const existing = await listPublishRecords(db, { from: 0, limit: STORE_LIMIT });
  const merged = mergeOfficialPublishRecords(existing, incoming).slice(0, Math.max(1, Number(limit) || STORE_LIMIT));
  if (await hasPublishTable(db)) {
    await replacePublishRecordRows(db, merged);
    await kvSet(db, KV_KEY, []);
  } else {
    await kvSet(db, KV_KEY, merged);
  }
  return merged;
}
