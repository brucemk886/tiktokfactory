-- Original frames and twenty independently managed recreation versions.
CREATE TABLE psychology_video_hits (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, external_id TEXT NOT NULL,
 video_url TEXT NOT NULL, title TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
 script TEXT NOT NULL DEFAULT '', video_data_json TEXT NOT NULL DEFAULT '{}',
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(owner_id, external_id)
);
CREATE INDEX psychology_video_hits_owner ON psychology_video_hits(owner_id, updated_at DESC, id);
CREATE TABLE psychology_video_hit_versions (
 source_id TEXT NOT NULL REFERENCES psychology_video_hits(id), version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 20),
 name TEXT NOT NULL, title TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', script TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(source_id, version)
);
CREATE TABLE psychology_video_hit_frames (
 source_id TEXT NOT NULL REFERENCES psychology_video_hits(id), version INTEGER NOT NULL CHECK(version BETWEEN 0 AND 20),
 frame_index INTEGER NOT NULL CHECK(frame_index BETWEEN 1 AND 300),
 asset_id TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '',
 text TEXT NOT NULL DEFAULT '', duration_seconds REAL NOT NULL CHECK(duration_seconds BETWEEN 0.04 AND 60),
 PRIMARY KEY(source_id, version, frame_index)
);
CREATE TABLE psychology_video_hit_assets (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, r2_key TEXT NOT NULL,
 content_type TEXT NOT NULL, size INTEGER NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(owner_id, r2_key)
);
CREATE TABLE psychology_video_hit_requests (
 owner_id TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
 response_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner_id, request_id)
);
CREATE TABLE psychology_video_hit_guards (id INTEGER PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO psychology_video_hit_guards VALUES(1,1);
UPDATE factory_users SET sidebar_modules_json=json_insert(sidebar_modules_json,'$[#]','psychology-video-hits')
 WHERE role='admin' AND active=1 AND NOT EXISTS (SELECT 1 FROM json_each(sidebar_modules_json) WHERE value='psychology-video-hits');
