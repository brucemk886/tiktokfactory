ALTER TABLE psychology_video_hit_versions ADD COLUMN input_mode TEXT NOT NULL DEFAULT 'frames' CHECK(input_mode IN ('frames','video'));
ALTER TABLE psychology_video_hit_versions ADD COLUMN video_asset_id TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_video_hit_versions ADD COLUMN render_job_id TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_video_hit_versions ADD COLUMN render_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_hit_versions ADD COLUMN render_source_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_hit_versions ADD COLUMN publish_item_id TEXT NOT NULL DEFAULT '';
CREATE TABLE psychology_video_hit_videos (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, digest TEXT NOT NULL,
 file_name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
 r2_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
CREATE INDEX psychology_video_hit_videos_owner ON psychology_video_hit_videos(owner_id,created_at);
-- Preserve earlier reservations, including completed jobs subsequently pruned.
UPDATE psychology_video_hit_versions SET publish_item_id=COALESCE((SELECT i.id FROM psychology_publish_items i JOIN psychology_video_hits h ON h.id=psychology_video_hit_versions.source_id JOIN factory_users u ON u.id=h.owner_id WHERE i.source_id=h.id||':v'||psychology_video_hit_versions.version AND i.batch_id IN (SELECT b.id FROM psychology_publish_batches b WHERE b.created_by=u.username) ORDER BY i.id LIMIT 1),'');
ALTER TABLE psychology_video_hit_versions ADD COLUMN render_state TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_video_hit_versions ADD COLUMN publish_state TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_video_hit_versions ADD COLUMN published_url TEXT NOT NULL DEFAULT '';
CREATE INDEX psychology_video_hit_versions_publish_item ON psychology_video_hit_versions(publish_item_id) WHERE publish_item_id<>'';
CREATE TRIGGER psychology_video_hit_render_state AFTER UPDATE OF status ON factory_jobs BEGIN
 UPDATE psychology_video_hit_versions SET render_state=NEW.status WHERE render_job_id=NEW.id;
END;
CREATE TRIGGER psychology_video_hit_publish_insert AFTER INSERT ON factory_publish_records BEGIN
 UPDATE psychology_video_hit_versions SET publish_state=CASE WHEN lower(COALESCE(NULLIF(json_extract(NEW.value_json,'$.officialRemoteStatus'),''),json_extract(NEW.value_json,'$.status'))) IN ('published','publish_complete') THEN 'published' ELSE publish_state END,published_url=CASE WHEN lower(COALESCE(NULLIF(json_extract(NEW.value_json,'$.officialRemoteStatus'),''),json_extract(NEW.value_json,'$.status'))) IN ('published','publish_complete') THEN COALESCE(NULLIF(json_extract(NEW.value_json,'$.shareLink'),''),json_extract(NEW.value_json,'$.videoUrl'),'') ELSE published_url END WHERE publish_item_id=json_extract(NEW.value_json,'$.autoTaskId');
END;
CREATE TRIGGER psychology_video_hit_publish_update AFTER UPDATE OF value_json ON factory_publish_records BEGIN
 UPDATE psychology_video_hit_versions SET publish_state=CASE WHEN lower(COALESCE(NULLIF(json_extract(NEW.value_json,'$.officialRemoteStatus'),''),json_extract(NEW.value_json,'$.status'))) IN ('published','publish_complete') THEN 'published' ELSE publish_state END,published_url=CASE WHEN lower(COALESCE(NULLIF(json_extract(NEW.value_json,'$.officialRemoteStatus'),''),json_extract(NEW.value_json,'$.status'))) IN ('published','publish_complete') THEN COALESCE(NULLIF(json_extract(NEW.value_json,'$.shareLink'),''),json_extract(NEW.value_json,'$.videoUrl'),'') ELSE published_url END WHERE publish_item_id=json_extract(NEW.value_json,'$.autoTaskId');
END;
UPDATE psychology_video_hit_versions SET publish_state='reserved' WHERE publish_item_id<>'';

CREATE TABLE psychology_video_hit_video_usage (owner_id TEXT NOT NULL,digest TEXT NOT NULL,asset_id TEXT NOT NULL,item_id TEXT NOT NULL,PRIMARY KEY(owner_id,digest));
-- Recognize existing current-version render requests before accepting another request.
UPDATE psychology_video_hit_versions SET render_job_id=COALESCE((SELECT j.id FROM factory_jobs j JOIN psychology_video_hits h ON h.id=psychology_video_hit_versions.source_id JOIN factory_users u ON u.id=h.owner_id WHERE j.created_by=u.username AND j.type='psychology-video-remix' AND json_extract(j.payload_json,'$.videoRemix.sourceId')=h.id AND json_extract(j.payload_json,'$.videoRemix.version')=psychology_video_hit_versions.version AND json_extract(j.payload_json,'$.videoRemix.revision')=psychology_video_hit_versions.revision AND json_extract(j.payload_json,'$.videoRemix.sourceRevision')=h.revision ORDER BY j.created_at DESC,j.id DESC LIMIT 1),'') WHERE publish_item_id='';
UPDATE psychology_video_hit_versions SET render_revision=revision,render_source_revision=(SELECT revision FROM psychology_video_hits WHERE id=source_id),render_state=(SELECT status FROM factory_jobs WHERE id=render_job_id) WHERE render_job_id<>'';
UPDATE psychology_video_hit_versions SET publish_state='published',published_url=COALESCE((SELECT COALESCE(NULLIF(json_extract(r.value_json,'$.shareLink'),''),json_extract(r.value_json,'$.videoUrl'),'') FROM factory_publish_records r WHERE json_extract(r.value_json,'$.autoTaskId')=publish_item_id AND lower(COALESCE(NULLIF(json_extract(r.value_json,'$.officialRemoteStatus'),''),json_extract(r.value_json,'$.status'))) IN ('published','publish_complete') ORDER BY r.created_at DESC LIMIT 1),'') WHERE EXISTS(SELECT 1 FROM factory_publish_records r WHERE json_extract(r.value_json,'$.autoTaskId')=publish_item_id AND lower(COALESCE(NULLIF(json_extract(r.value_json,'$.officialRemoteStatus'),''),json_extract(r.value_json,'$.status'))) IN ('published','publish_complete'));

CREATE TABLE psychology_video_hit_render_assets (asset_id TEXT PRIMARY KEY,source_id TEXT NOT NULL,version INTEGER NOT NULL,owner_id TEXT NOT NULL);
INSERT INTO psychology_video_hit_render_assets(asset_id,source_id,version,owner_id) SELECT a.id,json_extract(j.payload_json,'$.videoRemix.sourceId'),json_extract(j.payload_json,'$.videoRemix.version'),u.id FROM psychology_video_assets a JOIN factory_jobs j ON j.id=a.source_job_id JOIN factory_users u ON u.username=a.owner WHERE j.type='psychology-video-remix';
