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
    platform: row.platform || "",
    factoryNovelId: row.factory_novel_id || "",
    audioId: row.audio_id || "",
    audioName: row.audio_name || "",
    audioSize: Number(row.audio_size) || 0,
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

export async function listPeerHitRowsForNovel(db, novel = {}) {
  const factoryId = String(novel?.id || "").trim();
  const bookId = String(novel?.bookId || "").trim();
  if (!factoryId && !bookId) return [];
  const clauses = [];
  const binds = [];
  if (factoryId) {
    clauses.push("factory_novel_id = ?");
    binds.push(factoryId);
  }
  if (bookId) {
    clauses.push("novel_id = ?");
    binds.push(bookId);
  }
  const { results } = await db.prepare(`
    SELECT * FROM ${TABLE}
    WHERE ${clauses.join(" OR ")}
    ORDER BY play_count DESC, updated_at DESC
    LIMIT 200
  `).bind(...binds).all();
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
      id, video_key, video_url, play_count, novel_title, novel_id, platform, factory_novel_id,
      video_data_json, source, imported_at, updated_at, audio_id, audio_name, audio_size
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_key) DO UPDATE SET
      video_url = excluded.video_url,
      play_count = excluded.play_count,
      novel_title = CASE WHEN excluded.novel_title = '' THEN factory_peer_hits.novel_title ELSE excluded.novel_title END,
      novel_id = CASE WHEN excluded.novel_id = '' THEN factory_peer_hits.novel_id ELSE excluded.novel_id END,
      platform = CASE WHEN excluded.platform = '' THEN factory_peer_hits.platform ELSE excluded.platform END,
      factory_novel_id = CASE WHEN excluded.factory_novel_id = '' THEN factory_peer_hits.factory_novel_id ELSE excluded.factory_novel_id END,
      video_data_json = excluded.video_data_json,
      source = excluded.source,
      updated_at = excluded.updated_at,
      audio_id = CASE WHEN excluded.audio_id = '' THEN factory_peer_hits.audio_id ELSE excluded.audio_id END,
      audio_name = CASE WHEN excluded.audio_name = '' THEN factory_peer_hits.audio_name ELSE excluded.audio_name END,
      audio_size = CASE WHEN excluded.audio_id = '' THEN factory_peer_hits.audio_size ELSE excluded.audio_size END
  `).bind(
    hit.id,
    hit.videoKey,
    hit.videoUrl,
    hit.playCount,
    hit.novelTitle,
    hit.novelId,
    hit.platform || "",
    hit.factoryNovelId || "",
    JSON.stringify(hit.videoData || {}),
    hit.source,
    hit.importedAt,
    hit.updatedAt,
    hit.audioId || "",
    hit.audioName || "",
    Number(hit.audioSize) || 0
  ).run();
  return findPeerHitByKey(db, hit.videoKey);
}

export async function deletePeerHitRow(db, id) {
  await db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).bind(id).run();
}
