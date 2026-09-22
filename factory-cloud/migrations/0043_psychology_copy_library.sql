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
CREATE TRIGGER psychology_copy_on_peer_insert AFTER INSERT ON psychology_peer_hits BEGIN
 INSERT INTO psychology_copy_library(id,owner,media_type,title,source_url,source_json,created_at,updated_at) SELECT NEW.id,COALESCE((SELECT username FROM factory_users WHERE id=NEW.created_by),NEW.created_by),NEW.media_type,COALESCE(NEW.title,''),NEW.video_url,json_object('id',NEW.id,'videoUrl',NEW.video_url,'title',COALESCE(NEW.title,''),'mediaType',NEW.media_type,'platform',NEW.platform,'videoData',json(COALESCE(NEW.video_data_json,'{}')),'durationSeconds',NEW.duration_seconds),NEW.created_at,NEW.updated_at WHERE NOT EXISTS (SELECT 1 FROM psychology_copy_library WHERE id=NEW.id);
END;
CREATE TRIGGER psychology_copy_on_peer_update AFTER UPDATE ON psychology_peer_hits BEGIN
 INSERT INTO psychology_copy_library(id,owner,media_type,title,source_url,source_json,created_at,updated_at) SELECT NEW.id,COALESCE((SELECT username FROM factory_users WHERE id=NEW.created_by),NEW.created_by),NEW.media_type,COALESCE(NEW.title,''),NEW.video_url,json_object('id',NEW.id,'videoUrl',NEW.video_url,'title',COALESCE(NEW.title,''),'mediaType',NEW.media_type,'platform',NEW.platform,'videoData',json(COALESCE(NEW.video_data_json,'{}')),'durationSeconds',NEW.duration_seconds),NEW.created_at,NEW.updated_at WHERE NOT EXISTS (SELECT 1 FROM psychology_copy_library WHERE id=NEW.id);
 UPDATE psychology_copy_library SET title=COALESCE(NEW.title,''),source_url=NEW.video_url,source_json=json_object('id',NEW.id,'videoUrl',NEW.video_url,'title',COALESCE(NEW.title,''),'mediaType',NEW.media_type,'platform',NEW.platform,'videoData',json(COALESCE(NEW.video_data_json,'{}')),'durationSeconds',NEW.duration_seconds),
 status=CASE WHEN media_type<>NEW.media_type THEN 'queued' ELSE status END,
 attempt=attempt+CASE WHEN media_type<>NEW.media_type THEN 1 ELSE 0 END,
 content_json=CASE WHEN media_type<>NEW.media_type THEN '{}' ELSE content_json END,
 error=CASE WHEN media_type<>NEW.media_type THEN '' ELSE error END,
 workflow_id=CASE WHEN media_type<>NEW.media_type THEN '' ELSE workflow_id END,
 completed_at=CASE WHEN media_type<>NEW.media_type THEN 0 ELSE completed_at END,
 media_type=NEW.media_type,updated_at=NEW.updated_at WHERE id=NEW.id;
END;
INSERT INTO psychology_copy_library(id,owner,media_type,title,source_url,source_json,created_at,updated_at) SELECT p.id,COALESCE((SELECT username FROM factory_users WHERE id=p.created_by),p.created_by),p.media_type,COALESCE(p.title,''),p.video_url,json_object('id',p.id,'videoUrl',p.video_url,'title',COALESCE(p.title,''),'mediaType',p.media_type,'platform',p.platform,'videoData',json(COALESCE(p.video_data_json,'{}')),'durationSeconds',p.duration_seconds),p.created_at,p.updated_at FROM psychology_peer_hits p;
