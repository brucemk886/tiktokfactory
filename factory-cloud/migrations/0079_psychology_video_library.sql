CREATE TABLE psychology_video_assets (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, file_name TEXT NOT NULL,
 content_type TEXT NOT NULL DEFAULT 'video/mp4', file_size INTEGER NOT NULL DEFAULT 0,
 r2_key TEXT NOT NULL, source_job_id TEXT NOT NULL DEFAULT '', result_index INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX psychology_video_assets_owner ON psychology_video_assets(owner,created_at DESC,id);
CREATE UNIQUE INDEX psychology_video_assets_source ON psychology_video_assets(owner,source_job_id,result_index) WHERE source_job_id<>'';
