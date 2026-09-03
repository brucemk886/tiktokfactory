import { kvGet, kvSet } from "./kv.js";
import { mergeOfficialPublishRecords, normalizeOfficialPublishRecord, officialRecordTime } from "../../scripts/official-publish-records.js";

const TABLE = "factory_publish_records";
const KV_KEY = "official-publish-records";
const STORE_LIMIT = 3000;
// D1 caps bound parameters per statement at 100.
const ID_CHUNK = 90;
const WRITE_CHUNK = 40;

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
  await upsertPublishRecordRows(db, records);
  await kvSet(db, KV_KEY, []);
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
  for (let index = 0; index < items.length; index += WRITE_CHUNK) {
    const slice = items.slice(index, index + WRITE_CHUNK);
    await db.batch(slice.map((record) => statement.bind(
      record.id,
      officialRecordTime(record),
      JSON.stringify(record)
    )));
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

async function trimPublishRecords(db, limit = STORE_LIMIT) {
  const cap = Math.max(1, Math.min(Number(limit) || STORE_LIMIT, STORE_LIMIT));
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`).first();
  if (Number(count?.n || 0) <= cap) return 0;
  const result = await db.prepare(`
    DELETE FROM ${TABLE}
    WHERE id IN (SELECT id FROM ${TABLE} ORDER BY created_at DESC LIMIT -1 OFFSET ?)
  `).bind(cap).run();
  return Number(result?.meta?.changes || 0);
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
  if (!items.length) return { received: 0, written: 0, inserted: 0, trimmed: 0 };
  if (!await hasPublishTable(db)) {
    const stored = await kvGet(db, KV_KEY, []);
    const merged = mergeOfficialPublishRecords(stored, items).slice(0, Math.max(1, Number(limit) || STORE_LIMIT));
    await kvSet(db, KV_KEY, merged);
    return { received: items.length, written: merged.length, inserted: 0, trimmed: 0 };
  }

  const existing = await loadPublishRecordRowsByIds(db, items.map((item) => item.id));
  const changed = [];
  let inserted = 0;
  for (const item of items) {
    const row = existing.get(item.id);
    if (!row) {
      changed.push(item);
      inserted += 1;
      continue;
    }
    const previous = recordFromRow(row);
    const merged = previous ? mergeOfficialPublishRecords([previous], [item])[0] : item;
    if (!merged) continue;
    if (previous && Number(row.created_at) === officialRecordTime(merged) && sameRecord(previous, merged)) continue;
    changed.push(merged);
  }
  if (changed.length) await upsertPublishRecordRows(db, changed);
  const trimmed = inserted ? await trimPublishRecords(db, limit) : 0;
  return { received: items.length, written: changed.length, inserted, trimmed };
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
