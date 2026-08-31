export const SCRIPT_TRANSCRIPT_TABLE = "factory_script_transcripts";

export function stripScriptWords(script) {
  if (!script || typeof script !== "object") return script;
  const copy = { ...script };
  delete copy.words;
  return copy;
}

export function slimNovelScripts(scripts = []) {
  return (Array.isArray(scripts) ? scripts : []).map((script) => stripScriptWords(script));
}

export function scriptNeedsTranscriptPersist(script = {}) {
  return Boolean(script?.id && Array.isArray(script.words) && script.words.length);
}

export async function upsertScriptTranscript(db, script) {
  if (!scriptNeedsTranscriptPersist(script)) return false;
  const now = Date.now();
  await db.prepare(`
    INSERT INTO ${SCRIPT_TRANSCRIPT_TABLE} (
      script_id, novel_id, text, words_json, provider, model, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(script_id) DO UPDATE SET
      novel_id = excluded.novel_id,
      text = excluded.text,
      words_json = excluded.words_json,
      provider = excluded.provider,
      model = excluded.model,
      updated_at = excluded.updated_at
  `).bind(
    String(script.id),
    String(script.novelId || ""),
    String(script.text || "").slice(0, 20_000),
    JSON.stringify(script.words),
    String(script.transcriptProvider || ""),
    String(script.transcriptModel || ""),
    now
  ).run();
  return true;
}

export async function persistScriptTranscripts(db, scripts = []) {
  const items = (Array.isArray(scripts) ? scripts : []).filter(scriptNeedsTranscriptPersist);
  for (const script of items) await upsertScriptTranscript(db, script);
  return items.length;
}

function parseWordsJson(value) {
  try {
    const words = JSON.parse(value || "[]");
    return Array.isArray(words) ? words : [];
  } catch {
    return [];
  }
}

export function attachTranscriptRow(script, row) {
  if (!script || !row) return script;
  const words = parseWordsJson(row.words_json);
  return {
    ...script,
    text: String(script.text || "").trim() ? script.text : (row.text || script.text),
    words: Array.isArray(script.words) && script.words.length ? script.words : words,
    transcriptProvider: script.transcriptProvider || row.provider || "",
    transcriptModel: script.transcriptModel || row.model || ""
  };
}

export async function attachScriptTranscripts(db, scripts = []) {
  const items = Array.isArray(scripts) ? scripts : [];
  const ids = [...new Set(items.map((script) => String(script?.id || "").trim()).filter(Boolean))];
  if (!ids.length) return items;
  const { results } = await db.prepare(`
    SELECT script_id, novel_id, text, words_json, provider, model
    FROM ${SCRIPT_TRANSCRIPT_TABLE}
    WHERE script_id IN (${ids.map(() => "?").join(", ")})
  `).bind(...ids).all();
  const byId = new Map((results || []).map((row) => [String(row.script_id), row]));
  return items.map((script) => attachTranscriptRow(script, byId.get(String(script.id))));
}
