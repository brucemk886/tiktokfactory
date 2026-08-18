import fs from "node:fs";
import path from "node:path";
import { filterJournalEntries, normalizeJournalEntry, summarizeJournal } from "./work-journal.js";

export function createWorkJournalService({ workDir, now = Date.now } = {}) {
  const filePath = path.join(workDir, "work-journal.json");

  function list({ kind = "", query = "", dateKey = "" } = {}) {
    const entries = filterJournalEntries(readStore().entries, { kind, query, dateKey });
    return { entries, summary: summarizeJournal(entries) };
  }

  function create(payload) {
    const store = readStore();
    const entry = normalizeJournalEntry(payload, { id: `journal-${now()}`, now: now() });
    store.entries.unshift(entry);
    writeStore(store);
    return entry;
  }

  function update(id, payload) {
    const store = readStore();
    const index = store.entries.findIndex((item) => item.id === id);
    if (index < 0) throw Object.assign(new Error("没有找到该记录。"), { status: 404 });
    const entry = normalizeJournalEntry({ ...store.entries[index], ...payload }, { id, now: now() });
    entry.createdAt = store.entries[index].createdAt;
    store.entries[index] = entry;
    writeStore(store);
    return entry;
  }

  function remove(id) {
    const store = readStore();
    const next = store.entries.filter((item) => item.id !== id);
    if (next.length === store.entries.length) throw Object.assign(new Error("没有找到该记录。"), { status: 404 });
    store.entries = next;
    writeStore(store);
    return { ok: true };
  }

  function readStore() {
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return { entries: Array.isArray(value.entries) ? value.entries : [] };
    } catch {
      return { entries: [] };
    }
  }

  function writeStore(store) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ entries: store.entries }, null, 2), "utf8");
  }

  return { list, create, update, remove };
}
