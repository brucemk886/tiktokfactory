-- Preserve original topics; cleaned version tombstones no longer consume twenty active slots.
PRAGMA defer_foreign_keys=ON;
DROP TRIGGER psychology_video_hit_publish_insert;
DROP TRIGGER psychology_video_hit_publish_update;
DROP TRIGGER psychology_video_hit_published_time;
DROP TRIGGER psychology_video_hit_render_state;
CREATE TABLE psychology_video_hit_versions_continuous (
 source_id TEXT NOT NULL REFERENCES psychology_video_hits(id), version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 2147483647),
 name TEXT NOT NULL, title TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', script TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, input_mode TEXT NOT NULL DEFAULT 'frames' CHECK(input_mode IN ('frames','video')), video_asset_id TEXT NOT NULL DEFAULT '', render_job_id TEXT NOT NULL DEFAULT '', render_revision INTEGER NOT NULL DEFAULT 0, render_source_revision INTEGER NOT NULL DEFAULT 0, publish_item_id TEXT NOT NULL DEFAULT '', render_state TEXT NOT NULL DEFAULT '', publish_state TEXT NOT NULL DEFAULT '', published_url TEXT NOT NULL DEFAULT '', published_at INTEGER NOT NULL DEFAULT 0, cleaned_at INTEGER NOT NULL DEFAULT 0, cleaned_frame_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(source_id, version)
);
INSERT INTO psychology_video_hit_versions_continuous(source_id,version,name,title,caption,script,enabled,revision,created_at,updated_at,input_mode,video_asset_id,render_job_id,render_revision,render_source_revision,publish_item_id,render_state,publish_state,published_url,published_at,cleaned_at,cleaned_frame_count) SELECT source_id,version,name,title,caption,script,enabled,revision,created_at,updated_at,input_mode,video_asset_id,render_job_id,render_revision,render_source_revision,publish_item_id,render_state,publish_state,published_url,published_at,cleaned_at,cleaned_frame_count FROM psychology_video_hit_versions;
DROP TABLE psychology_video_hit_versions;
ALTER TABLE psychology_video_hit_versions_continuous RENAME TO psychology_video_hit_versions;
CREATE INDEX psychology_video_hit_versions_cleanup ON psychology_video_hit_versions(publish_state,cleaned_at,published_at);
CREATE INDEX psychology_video_hit_versions_publish_item ON psychology_video_hit_versions(publish_item_id) WHERE publish_item_id<>'';
CREATE TABLE psychology_video_hit_frames_continuous (
 source_id TEXT NOT NULL REFERENCES psychology_video_hits(id), version INTEGER NOT NULL CHECK(version BETWEEN 0 AND 2147483647),
 frame_index INTEGER NOT NULL CHECK(frame_index BETWEEN 1 AND 300),
 asset_id TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '',
 text TEXT NOT NULL DEFAULT '', duration_seconds REAL NOT NULL CHECK(duration_seconds BETWEEN 0.04 AND 60),
 PRIMARY KEY(source_id, version, frame_index)
);
INSERT INTO psychology_video_hit_frames_continuous(source_id,version,frame_index,asset_id,image_url,text,duration_seconds) SELECT source_id,version,frame_index,asset_id,image_url,text,duration_seconds FROM psychology_video_hit_frames;
DROP TABLE psychology_video_hit_frames;
ALTER TABLE psychology_video_hit_frames_continuous RENAME TO psychology_video_hit_frames;

CREATE TRIGGER psychology_video_hit_publish_insert AFTER INSERT ON factory_publish_records BEGIN
 UPDATE psychology_video_hit_versions SET publish_state=CASE WHEN lower(COALESCE(NULLIF(json_extract(NEW.value_json,'$.officialRemoteStatus'),''),json_extract(NEW.value_json,'$.status'))) IN ('published','publish_complete') THEN 'published' ELSE publish_state END,published_url=CASE WHEN lower(COALESCE(NULLIF(json_extract(NEW.value_json,'$.officialRemoteStatus'),''),json_extract(NEW.value_json,'$.status'))) IN ('published','publish_complete') THEN COALESCE(NULLIF(json_extract(NEW.value_json,'$.shareLink'),''),json_extract(NEW.value_json,'$.videoUrl'),'') ELSE published_url END WHERE publish_item_id=json_extract(NEW.value_json,'$.autoTaskId');
END;
CREATE TRIGGER psychology_video_hit_publish_update AFTER UPDATE OF value_json ON factory_publish_records BEGIN
 UPDATE psychology_video_hit_versions SET publish_state=CASE WHEN lower(COALESCE(NULLIF(json_extract(NEW.value_json,'$.officialRemoteStatus'),''),json_extract(NEW.value_json,'$.status'))) IN ('published','publish_complete') THEN 'published' ELSE publish_state END,published_url=CASE WHEN lower(COALESCE(NULLIF(json_extract(NEW.value_json,'$.officialRemoteStatus'),''),json_extract(NEW.value_json,'$.status'))) IN ('published','publish_complete') THEN COALESCE(NULLIF(json_extract(NEW.value_json,'$.shareLink'),''),json_extract(NEW.value_json,'$.videoUrl'),'') ELSE published_url END WHERE publish_item_id=json_extract(NEW.value_json,'$.autoTaskId');
END;
CREATE TRIGGER psychology_video_hit_published_time AFTER UPDATE OF publish_state ON psychology_video_hit_versions WHEN NEW.publish_state='published' AND NEW.published_at=0 BEGIN
 UPDATE psychology_video_hit_versions SET published_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE source_id=NEW.source_id AND version=NEW.version;
END;
CREATE TRIGGER psychology_video_hit_render_state AFTER UPDATE OF status ON factory_jobs BEGIN
 UPDATE psychology_video_hit_versions SET render_state=NEW.status WHERE render_job_id=NEW.id;
END;
CREATE INDEX psychology_video_hit_versions_active ON psychology_video_hit_versions(source_id,cleaned_at);
CREATE TRIGGER psychology_video_hit_active_limit BEFORE INSERT ON psychology_video_hit_versions WHEN NEW.cleaned_at=0 AND (SELECT COUNT(*) FROM psychology_video_hit_versions WHERE source_id=NEW.source_id AND cleaned_at=0)>=20 BEGIN
 SELECT RAISE(ABORT,'video_hit_active_limit');
END;
PRAGMA defer_foreign_keys=OFF;
