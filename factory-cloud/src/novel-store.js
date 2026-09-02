import { kvGet, kvSet } from "./kv.js";
import { persistScriptTranscripts, slimNovelScripts } from "./script-transcripts.js";

export function novelFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    bookId: row.book_id || "",
    promotionCode: row.promotion_code || "",
    promotionCopy: row.promotion_copy || "",
    category: row.category || "",
    featured: Boolean(row.featured),
    sellingPoint: row.selling_point || "",
    note: row.note || "",
    sourceContent: row.source_content || "",
    status: row.status || "active",
    working: Boolean(row.working),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const NOVEL_SUMMARY_COLUMNS = `id, title, platform, book_id, promotion_code, promotion_copy, category, featured,
           selling_point, note, substr(source_content, 1, 160) AS source_content, status, created_at, updated_at, working`;
const NOVEL_COUNT_KEY = "novel-catalog-count";

function novelColumnValues(novel) {
  return [
    novel.id,
    String(novel.title || "").slice(0, 180),
    novel.platform || "NovelMaster",
    String(novel.bookId || "").slice(0, 240),
    String(novel.promotionCode || "").slice(0, 240),
    String(novel.promotionCopy || "").slice(0, 5_000),
    String(novel.category || "").slice(0, 120),
    novel.featured ? 1 : 0,
    String(novel.sellingPoint || "").slice(0, 2_000),
    String(novel.note || "").slice(0, 2_000),
    String(novel.sourceContent || "").slice(0, 200_000),
    novel.status || "active",
    novel.createdAt,
    novel.updatedAt,
    novel.working ? 1 : 0
  ];
}

export async function listNovels(db) {
  const { results } = await db.prepare("SELECT * FROM factory_novels").all();
  return (results || []).map(novelFromRow);
}

export async function listNovelSummaries(db) {
  const { results } = await db.prepare(`
    SELECT ${NOVEL_SUMMARY_COLUMNS}
    FROM factory_novels
  `).all();
  return (results || []).map(novelFromRow);
}

export async function listWorkingNovelSummaries(db) {
  const { results } = await db.prepare(`
    SELECT ${NOVEL_SUMMARY_COLUMNS}
    FROM factory_novels
    WHERE working = 1
  `).all();
  return (results || []).map(novelFromRow);
}

export async function countNovels(db) {
  const cached = await kvGet(db, NOVEL_COUNT_KEY, null);
  if (cached && Number.isFinite(Number(cached.n))) return Number(cached.n);
  const row = await db.prepare("SELECT COUNT(*) AS n FROM factory_novels").first();
  const n = Number(row?.n || 0);
  await kvSet(db, NOVEL_COUNT_KEY, { n });
  return n;
}

async function invalidateNovelCount(db) {
  await db.prepare("DELETE FROM factory_kv WHERE key = ?").bind(NOVEL_COUNT_KEY).run();
}

function uniqueNovelIds(ids = []) {
  return [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean))];
}

async function updateWorkingFlag(db, ids = [], working) {
  const wanted = uniqueNovelIds(ids);
  if (!wanted.length) return 0;
  const flag = working ? 1 : 0;
  const opposite = working ? 0 : 1;
  let changed = 0;
  for (let index = 0; index < wanted.length; index += 40) {
    const slice = wanted.slice(index, index + 40);
    const result = await db.prepare(
      `UPDATE factory_novels SET working = ${flag} WHERE id IN (${slice.map(() => "?").join(", ")}) AND working = ${opposite}`
    ).bind(...slice).run();
    changed += Number(result?.meta?.changes || 0);
  }
  return changed;
}

export async function markNovelsWorking(db, ids = []) {
  return updateWorkingFlag(db, ids, true);
}

export async function markNovelsIdle(db, ids = []) {
  return updateWorkingFlag(db, ids, false);
}

export async function syncWorkingNovels(db, extraIds = [], { unmarkMissing = false } = {}) {
  const wanted = uniqueNovelIds(extraIds);
  const marked = await markNovelsWorking(db, wanted);
  if (!unmarkMissing) return { marked, unmarked: 0 };
  const { results } = await db.prepare("SELECT id FROM factory_novels WHERE working = 1").all();
  const keep = new Set(wanted);
  const drop = (results || []).map((row) => String(row.id || "").trim()).filter((id) => id && !keep.has(id));
  return { marked, unmarked: await markNovelsIdle(db, drop) };
}

export async function updateNovelBookId(db, id, bookId, updatedAt) {
  const wanted = String(id || "").trim();
  if (!wanted) return;
  await db.prepare("UPDATE factory_novels SET book_id = ?, updated_at = ? WHERE id = ?")
    .bind(String(bookId || "").slice(0, 240), updatedAt, wanted)
    .run();
}

function novelMatchRow(row) {
  return {
    id: row.id,
    title: row.title || "",
    platform: row.platform || "",
    bookId: row.book_id || ""
  };
}

export async function listNovelMatchIndex(db) {
  const { results } = await db.prepare("SELECT id, title, platform, book_id FROM factory_novels").all();
  return (results || []).map(novelMatchRow);
}

export async function listNovelsMatchingPeerHit(db, hit = {}) {
  return listNovelsMatchingPeerHits(db, [hit]);
}

export async function listNovelsMatchingPeerHits(db, hits = []) {
  const ids = new Set();
  const titles = new Set();
  for (const hit of Array.isArray(hits) ? hits : []) {
    const factoryId = String(hit?.factoryNovelId || "").trim();
    const bookId = String(hit?.novelId || "").trim();
    const title = String(hit?.novelTitle || "").trim();
    if (factoryId) ids.add(factoryId);
    if (bookId) ids.add(bookId);
    if (title) titles.add(title);
  }
  const idList = [...ids];
  const titleList = [...titles];
  if (!idList.length && !titleList.length) return [];
  if (idList.length * 2 + titleList.length > 80) return listNovelMatchIndex(db);
  const clauses = [];
  const binds = [];
  if (idList.length) {
    const marks = idList.map(() => "?").join(", ");
    clauses.push(`id IN (${marks})`);
    clauses.push(`book_id IN (${marks})`);
    binds.push(...idList, ...idList);
  }
  if (titleList.length) {
    clauses.push(`title IN (${titleList.map(() => "?").join(", ")})`);
    binds.push(...titleList);
  }
  const { results } = await db.prepare(`
    SELECT id, title, platform, book_id FROM factory_novels
    WHERE ${clauses.join(" OR ")}
    LIMIT 100
  `).bind(...binds).all();
  return (results || []).map(novelMatchRow);
}

export async function insertNovels(db, novels = []) {
  const items = Array.isArray(novels) ? novels.filter((item) => item?.id && item.title) : [];
  if (!items.length) return 0;
  const statement = db.prepare(`
    INSERT OR IGNORE INTO factory_novels (
      id, title, platform, book_id, promotion_code, promotion_copy, category, featured,
      selling_point, note, source_content, status, created_at, updated_at, working
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let index = 0; index < items.length; index += 40) {
    const slice = items.slice(index, index + 40);
    await db.batch(slice.map((novel) => statement.bind(...novelColumnValues(novel))));
  }
  await invalidateNovelCount(db);
  return items.length;
}

export async function upsertNovel(db, novel) {
  await db.prepare(`
    INSERT INTO factory_novels (
      id, title, platform, book_id, promotion_code, promotion_copy, category, featured,
      selling_point, note, source_content, status, created_at, updated_at, working
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      platform = excluded.platform,
      book_id = excluded.book_id,
      promotion_code = excluded.promotion_code,
      promotion_copy = excluded.promotion_copy,
      category = excluded.category,
      featured = excluded.featured,
      selling_point = excluded.selling_point,
      note = excluded.note,
      source_content = excluded.source_content,
      status = excluded.status,
      updated_at = excluded.updated_at,
      working = CASE WHEN factory_novels.working = 1 OR excluded.working = 1 THEN 1 ELSE 0 END
  `).bind(...novelColumnValues(novel)).run();
  await invalidateNovelCount(db);
  return novel;
}

export async function deleteNovelRow(db, id) {
  await db.prepare("DELETE FROM factory_novels WHERE id = ?").bind(String(id || "").trim()).run();
  await invalidateNovelCount(db);
}

export async function getNovelRow(db, id) {
  const wanted = String(id || "").trim();
  if (!wanted) return null;
  const row = await db.prepare("SELECT * FROM factory_novels WHERE id = ?").bind(wanted).first();
  return row ? novelFromRow(row) : null;
}

const SCRIPT_TABLE = "factory_novel_scripts";

function filterScripts(scripts = [], options = {}) {
  const items = Array.isArray(scripts) ? scripts : [];
  if (!options.novelIds && !options.includeUnassigned) return items;
  const wanted = new Set((Array.isArray(options.novelIds) ? options.novelIds : []).map((id) => String(id || "").trim()).filter(Boolean));
  return items.filter((script) => {
    const novelId = String(script?.novelId || "").trim();
    if (!novelId) return Boolean(options.includeUnassigned);
    return wanted.has(novelId);
  });
}

async function hasScriptTable(db) {
  try {
    await db.prepare(`SELECT 1 FROM ${SCRIPT_TABLE} LIMIT 1`).first();
    return true;
  } catch {
    return false;
  }
}

function scriptFromRow(row) {
  try {
    const parsed = JSON.parse(row?.value_json || "{}");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function listScriptsFromTable(db, options = {}) {
  const novelIds = uniqueNovelIds(options.novelIds || []);
  const clauses = [];
  const binds = [];
  if (novelIds.length) {
    clauses.push(`novel_id IN (${novelIds.map(() => "?").join(", ")})`);
    binds.push(...novelIds);
  }
  if (options.includeUnassigned) clauses.push("novel_id = ''");
  const where = clauses.length ? `WHERE ${clauses.join(" OR ")}` : "";
  const { results } = binds.length
    ? await db.prepare(`SELECT value_json FROM ${SCRIPT_TABLE} ${where}`).bind(...binds).all()
    : await db.prepare(`SELECT value_json FROM ${SCRIPT_TABLE} ${where}`).all();
  return (results || []).map(scriptFromRow).filter(Boolean);
}

export async function migrateScriptsFromKv(db) {
  if (!await hasScriptTable(db)) return 0;
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM ${SCRIPT_TABLE}`).first();
  if (Number(count?.n || 0) > 0) return 0;
  const store = await kvGet(db, "novel-content", { novels: [], scripts: [] });
  const scripts = slimNovelScripts(Array.isArray(store?.scripts) ? store.scripts : []);
  if (!scripts.length) return 0;
  await replaceScriptRows(db, scripts);
  await kvSet(db, "novel-content", { novels: [], scripts: [] });
  return scripts.length;
}

async function replaceScriptRows(db, scripts = []) {
  const items = slimNovelScripts(scripts).filter((script) => script?.id);
  const now = Date.now();
  const statement = db.prepare(`
    INSERT INTO ${SCRIPT_TABLE} (id, novel_id, audio_id, value_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      novel_id = excluded.novel_id,
      audio_id = excluded.audio_id,
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `);
  for (let index = 0; index < items.length; index += 40) {
    const slice = items.slice(index, index + 40);
    await db.batch(slice.map((script) => statement.bind(
      String(script.id),
      String(script.novelId || "").trim(),
      String(script.audioId || script.audio?.id || "").trim(),
      JSON.stringify(script),
      now
    )));
  }
  const keep = new Set(items.map((script) => String(script.id)));
  const { results } = await db.prepare(`SELECT id FROM ${SCRIPT_TABLE}`).all();
  const drop = (results || []).map((row) => String(row.id || "")).filter((id) => id && !keep.has(id));
  for (let index = 0; index < drop.length; index += 40) {
    const slice = drop.slice(index, index + 40);
    await db.prepare(`DELETE FROM ${SCRIPT_TABLE} WHERE id IN (${slice.map(() => "?").join(", ")})`).bind(...slice).run();
  }
  return items.length;
}

export async function listNovelScripts(db, options = {}) {
  await migrateScriptsFromKv(db);
  if (await hasScriptTable(db)) return listScriptsFromTable(db, options);
  const store = await kvGet(db, "novel-content", { novels: [], scripts: [] });
  return filterScripts(store.scripts, options);
}

export async function writeScripts(db, scripts) {
  const slim = slimNovelScripts(scripts);
  await migrateScriptsFromKv(db);
  await persistScriptTranscripts(db, scripts);
  if (await hasScriptTable(db)) {
    await replaceScriptRows(db, slim);
    await kvSet(db, "novel-content", { novels: [], scripts: [] });
  } else {
    await kvSet(db, "novel-content", { novels: [], scripts: slim });
  }
  await syncWorkingNovels(db, slim.map((item) => item.novelId), { unmarkMissing: false });
  return { novels: [], scripts: slim };
}

export async function migrateNovelsFromKv(db) {
  const count = await db.prepare("SELECT COUNT(*) AS n FROM factory_novels").first();
  if (Number(count?.n || 0) > 0) return;
  const store = await kvGet(db, "novel-content", { novels: [], scripts: [] });
  const novels = Array.isArray(store.novels) ? store.novels : [];
  if (!novels.length) return;
  await insertNovels(db, novels);
  await kvSet(db, "novel-content", { novels: [], scripts: Array.isArray(store.scripts) ? store.scripts : [] });
}
