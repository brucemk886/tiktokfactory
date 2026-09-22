-- Durable original-copy inbox, separate from owner-scoped reviewed variants.
CREATE TABLE psychology_copy_library (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, media_type TEXT NOT NULL CHECK(media_type IN ('video','photo')),
 title TEXT NOT NULL, source_url TEXT NOT NULL, source_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','failed')),
 content_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
 attempt INTEGER NOT NULL DEFAULT 0, workflow_id TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL DEFAULT '{}',
 started_at INTEGER NOT NULL DEFAULT 0, dispatch_at INTEGER NOT NULL DEFAULT 0,
 provider TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX psychology_copy_library_due ON psychology_copy_library(status,created_at,id);
CREATE INDEX psychology_copy_library_media ON psychology_copy_library(media_type,created_at,id);
INSERT INTO psychology_copy_library(id,owner,media_type,title,source_url,source_json,created_at,updated_at) SELECT p.id,COALESCE((SELECT username FROM factory_users WHERE id=p.created_by),p.created_by),p.media_type,COALESCE(p.title,''),p.video_url,json_object('id',p.id,'videoUrl',p.video_url,'title',COALESCE(p.title,''),'mediaType',p.media_type,'platform',p.platform,'videoData',json(COALESCE(p.video_data_json,'{}')),'durationSeconds',p.duration_seconds),p.created_at,p.updated_at FROM psychology_peer_hits p;
