ALTER TABLE psychology_video_hit_versions ADD COLUMN published_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_hit_versions ADD COLUMN cleaned_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_hit_versions ADD COLUMN cleaned_frame_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_hits ADD COLUMN archived_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_hits ADD COLUMN originals_cleaned_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_hit_assets ADD COLUMN cleanup_state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE psychology_video_hit_assets ADD COLUMN last_touched_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_hit_assets ADD COLUMN cleaned_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_hit_assets ADD COLUMN cleanup_error TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_video_hit_videos ADD COLUMN cleanup_state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE psychology_video_hit_videos ADD COLUMN last_touched_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_hit_videos ADD COLUMN cleaned_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_hit_videos ADD COLUMN cleanup_error TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_video_assets ADD COLUMN cleanup_state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE psychology_video_assets ADD COLUMN cleaned_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_assets ADD COLUMN cleanup_error TEXT NOT NULL DEFAULT '';
UPDATE psychology_video_hit_assets SET last_touched_at=created_at;
UPDATE psychology_video_hit_videos SET last_touched_at=created_at;
-- Historical confirmation starts a fresh grace period at rollout, never an immediate purge.
UPDATE psychology_video_hit_versions SET published_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE publish_state='published';
CREATE INDEX psychology_video_hit_versions_cleanup ON psychology_video_hit_versions(publish_state,cleaned_at,published_at);
CREATE INDEX psychology_video_hit_assets_cleanup ON psychology_video_hit_assets(cleanup_state,last_touched_at);
CREATE INDEX psychology_video_hit_videos_cleanup ON psychology_video_hit_videos(cleanup_state,last_touched_at);
CREATE TRIGGER psychology_video_hit_published_time AFTER UPDATE OF publish_state ON psychology_video_hit_versions WHEN NEW.publish_state='published' AND NEW.published_at=0 BEGIN
 UPDATE psychology_video_hit_versions SET published_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE source_id=NEW.source_id AND version=NEW.version;
END;
CREATE TABLE psychology_video_hit_job_assets(job_id TEXT NOT NULL,kind TEXT NOT NULL,asset_id TEXT NOT NULL,PRIMARY KEY(job_id,kind,asset_id));
CREATE INDEX psychology_video_hit_job_assets_ref ON psychology_video_hit_job_assets(kind,asset_id,job_id);
INSERT OR IGNORE INTO psychology_video_hit_job_assets SELECT j.id,'image',n.value FROM factory_jobs j,json_tree(j.payload_json) n WHERE n.key='assetId' AND EXISTS(SELECT 1 FROM psychology_video_hit_assets a WHERE a.id=n.value);
INSERT OR IGNORE INTO psychology_video_hit_job_assets SELECT j.id,'video',n.value FROM factory_jobs j,json_tree(j.payload_json) n WHERE n.key IN ('assetId','videoAssetId') AND (EXISTS(SELECT 1 FROM psychology_video_hit_videos a WHERE a.id=n.value) OR EXISTS(SELECT 1 FROM psychology_video_hit_render_assets a WHERE a.asset_id=n.value));
CREATE TRIGGER psychology_video_hit_job_asset_insert AFTER INSERT ON factory_jobs BEGIN
 INSERT OR IGNORE INTO psychology_video_hit_job_assets SELECT NEW.id,'image',n.value FROM json_tree(NEW.payload_json) n WHERE n.key='assetId' AND EXISTS(SELECT 1 FROM psychology_video_hit_assets a WHERE a.id=n.value);
 INSERT OR IGNORE INTO psychology_video_hit_job_assets SELECT NEW.id,'video',n.value FROM json_tree(NEW.payload_json) n WHERE n.key IN ('assetId','videoAssetId') AND (EXISTS(SELECT 1 FROM psychology_video_hit_videos a WHERE a.id=n.value) OR EXISTS(SELECT 1 FROM psychology_video_hit_render_assets a WHERE a.asset_id=n.value));
END;
CREATE TRIGGER psychology_video_hit_job_asset_update AFTER UPDATE OF payload_json ON factory_jobs BEGIN
 DELETE FROM psychology_video_hit_job_assets WHERE job_id=OLD.id;
 INSERT OR IGNORE INTO psychology_video_hit_job_assets SELECT NEW.id,'image',n.value FROM json_tree(NEW.payload_json) n WHERE n.key='assetId' AND EXISTS(SELECT 1 FROM psychology_video_hit_assets a WHERE a.id=n.value);
 INSERT OR IGNORE INTO psychology_video_hit_job_assets SELECT NEW.id,'video',n.value FROM json_tree(NEW.payload_json) n WHERE n.key IN ('assetId','videoAssetId') AND (EXISTS(SELECT 1 FROM psychology_video_hit_videos a WHERE a.id=n.value) OR EXISTS(SELECT 1 FROM psychology_video_hit_render_assets a WHERE a.asset_id=n.value));
END;
CREATE TRIGGER psychology_video_hit_job_asset_delete AFTER DELETE ON factory_jobs BEGIN
 DELETE FROM psychology_video_hit_job_assets WHERE job_id=OLD.id;
END;
CREATE TABLE psychology_video_hit_local_files(job_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,source_id TEXT NOT NULL,version INTEGER NOT NULL,worker_id TEXT NOT NULL,file_name TEXT NOT NULL,cleanup_job_id TEXT NOT NULL DEFAULT '',cleaned_at INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
CREATE TRIGGER psychology_video_hit_local_file AFTER UPDATE OF result_json ON factory_jobs WHEN NEW.type='psychology-video-remix' AND NEW.status='done' AND NEW.worker_id<>'' BEGIN
 INSERT OR IGNORE INTO psychology_video_hit_local_files(job_id,owner_id,source_id,version,worker_id,file_name,created_at) SELECT NEW.id,u.id,json_extract(NEW.payload_json,'$.videoRemix.sourceId'),json_extract(NEW.payload_json,'$.videoRemix.version'),NEW.worker_id,NEW.id||'.mp4',NEW.updated_at FROM factory_users u WHERE u.username=NEW.created_by AND json_extract(NEW.result_json,'$.results[0].fileName')=NEW.id||'.mp4';
END;

-- Keep local cleanup identity even when completed render jobs are pruned later.
INSERT OR IGNORE INTO psychology_video_hit_local_files(job_id,owner_id,source_id,version,worker_id,file_name,created_at) SELECT j.id,u.id,json_extract(j.payload_json,'$.videoRemix.sourceId'),json_extract(j.payload_json,'$.videoRemix.version'),j.worker_id,j.id||'.mp4',j.updated_at FROM factory_jobs j JOIN factory_users u ON u.username=j.created_by WHERE j.type='psychology-video-remix' AND j.status='done' AND j.worker_id<>'' AND json_extract(j.result_json,'$.results[0].fileName')=j.id||'.mp4';
