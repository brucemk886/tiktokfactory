export async function kvGet(db, key, fallback) {
  const row = await db.prepare("SELECT value_json FROM factory_kv WHERE key = ?").bind(key).first();
  if (!row?.value_json) return fallback;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}

export async function kvSet(db, key, value) {
  const updatedAt = Date.now();
  await db.prepare(`
    INSERT INTO factory_kv (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).bind(key, JSON.stringify(value), updatedAt).run();
  return value;
}
