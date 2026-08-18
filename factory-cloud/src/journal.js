import { emptyMindmap, filterJournalEntries, normalizeJournalEntry, summarizeJournal } from "../../scripts/work-journal.js";
import { errorJson, json, now, readJson, safeId } from "./http.js";

export async function handleJournal(request, env, url, session) {
  if (!session) return null;
  if (!url.pathname.startsWith("/api/work-journal")) return null;
  const db = env.DB;
  const method = request.method;
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/work-journal") {
    const rows = (await db.prepare("SELECT * FROM work_journal_entries ORDER BY date_key DESC, updated_at DESC").all()).results || [];
    const entries = filterJournalEntries(rows.map(fromRow), {
      kind: url.searchParams.get("kind") || "",
      query: url.searchParams.get("query") || "",
      dateKey: url.searchParams.get("date") || "",
    });
    return json({ entries, summary: summarizeJournal(entries) });
  }

  if (method === "POST" && pathname === "/api/work-journal") {
    const entry = normalizeJournalEntry(await readJson(request), { id: safeId(`journal-${now()}`), now: now() });
    await upsertEntry(db, entry);
    return json({ entry }, 201);
  }

  const match = pathname.match(/^\/api\/work-journal\/([^/]+)$/);
  if (!match) return errorJson("没有找到该记录。", 404);
  const id = decodeURIComponent(match[1]);
  const current = await db.prepare("SELECT * FROM work_journal_entries WHERE id = ?").bind(id).first();
  if (!current) return errorJson("没有找到该记录。", 404);

  if (method === "GET") return json({ entry: fromRow(current) });
  if (method === "DELETE") {
    await db.prepare("DELETE FROM work_journal_entries WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (method === "PATCH") {
    const entry = normalizeJournalEntry({ ...fromRow(current), ...await readJson(request) }, { id, now: now() });
    entry.createdAt = Number(current.created_at) || entry.createdAt;
    await upsertEntry(db, entry);
    return json({ entry });
  }
  return null;
}

async function upsertEntry(db, entry) {
  await db.prepare(`
    INSERT INTO work_journal_entries (id, kind, date_key, title, body, mindmap_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      date_key = excluded.date_key,
      title = excluded.title,
      body = excluded.body,
      mindmap_json = excluded.mindmap_json,
      updated_at = excluded.updated_at
  `).bind(
    entry.id,
    entry.kind,
    entry.dateKey,
    entry.title,
    entry.body,
    JSON.stringify(entry.mindmap || emptyMindmap(entry.title)),
    entry.createdAt,
    entry.updatedAt
  ).run();
}

function fromRow(row) {
  let mindmap = emptyMindmap(row.title);
  try {
    mindmap = JSON.parse(row.mindmap_json || "{}");
  } catch {
    mindmap = emptyMindmap(row.title);
  }
  return {
    id: row.id,
    kind: row.kind,
    dateKey: row.date_key,
    title: row.title,
    body: row.body || "",
    mindmap,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}
