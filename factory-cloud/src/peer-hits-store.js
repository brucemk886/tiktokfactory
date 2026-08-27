const TABLE = "factory_peer_hits";

export function peerHitFromRow(row) {
  if (!row) return null;
  let videoData = {};
  try {
    videoData = JSON.parse(row.video_data_json || "{}") || {};
  } catch {
    videoData = {};
  }
  return {
    id: row.id,
    videoKey: row.video_key,
    videoUrl: row.video_url,
    playCount: Number(row.play_count) || 0,
    novelTitle: row.novel_title || "",
    novelId: row.novel_id || "",
    factoryNovelId: row.factory_novel_id || "",
    videoData,
    source: row.source || "grokbot",
    importedAt: Number(row.imported_at) || 0,
    updatedAt: Number(row.updated_at) || 0
  };
}

export async function listPeerHitRows(db) {
  const { results } = await db.prepare(`
    SELECT * FROM ${TABLE}
    ORDER BY play_count DESC, updated_at DESC
    LIMIT 1000
  `).all();
  return (results || []).map(peerHitFromRow);
}

export async function findPeerHitByKey(db, videoKey) {
  const row = await db.prepare(`SELECT * FROM ${TABLE} WHERE video_key = ?`).bind(videoKey).first();
  return peerHitFromRow(row);
}

export async function findPeerHitById(db, id) {
  const row = await db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).bind(id).first();
  return peerHitFromRow(row);
}

export async function upsertPeerHitRow(db, hit) {
  await db.prepare(`
    INSERT INTO ${TABLE} (
      id, video_key, video_url, play_count, novel_title, novel_id, factory_novel_id,
      video_data_json, source, imported_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_key) DO UPDATE SET
      video_url = excluded.video_url,
      play_count = excluded.play_count,
      novel_title = CASE WHEN excluded.novel_title = '' THEN factory_peer_hits.novel_title ELSE excluded.novel_title END,
      novel_id = CASE WHEN excluded.novel_id = '' THEN factory_peer_hits.novel_id ELSE excluded.novel_id END,
      factory_novel_id = CASE WHEN excluded.factory_novel_id = '' THEN factory_peer_hits.factory_novel_id ELSE excluded.factory_novel_id END,
      video_data_json = excluded.video_data_json,
      source = excluded.source,
      updated_at = excluded.updated_at
  `).bind(
    hit.id,
    hit.videoKey,
    hit.videoUrl,
    hit.playCount,
    hit.novelTitle,
    hit.novelId,
    hit.factoryNovelId || "",
    JSON.stringify(hit.videoData || {}),
    hit.source,
    hit.importedAt,
    hit.updatedAt
  ).run();
  return findPeerHitByKey(db, hit.videoKey);
}

export async function deletePeerHitRow(db, id) {
  await db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).bind(id).run();
}
