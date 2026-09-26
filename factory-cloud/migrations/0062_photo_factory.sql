-- Parallel photo-only factory. No legacy psychology records are migrated or updated.
CREATE TABLE photo_directions (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
 config_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(owner,slug)
);
CREATE TABLE photo_copies (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, direction_id TEXT NOT NULL REFERENCES photo_directions(id),
 source_id TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('original','rewrite')),
 title TEXT NOT NULL, caption TEXT NOT NULL, pages_json TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]',
 metadata_json TEXT NOT NULL DEFAULT '{}', model TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, UNIQUE(owner,direction_id,external_id)
);
CREATE INDEX photo_copy_direction ON photo_copies(owner,direction_id,enabled,created_at,id);
CREATE INDEX photo_copy_source ON photo_copies(owner,direction_id,source_id);
CREATE TABLE photo_pilots (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, direction_id TEXT NOT NULL REFERENCES photo_directions(id),
 group_id TEXT NOT NULL, group_name TEXT NOT NULL, strategy TEXT NOT NULL CHECK(strategy IN ('balanced','original','rewrite')),
 config_json TEXT NOT NULL, accounts_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
 starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, next_check INTEGER NOT NULL DEFAULT 0,
 error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX photo_pilot_live_group ON photo_pilots(group_id) WHERE status IN ('active','paused');
CREATE INDEX photo_pilot_due ON photo_pilots(status,next_check);
CREATE TABLE photo_slots (
 pilot_id TEXT NOT NULL REFERENCES photo_pilots(id),slot_at INTEGER NOT NULL,status TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,PRIMARY KEY(pilot_id,slot_at)
);
CREATE TABLE photo_jobs (
 id TEXT PRIMARY KEY,owner TEXT NOT NULL,direction_id TEXT NOT NULL,pilot_id TEXT NOT NULL,
 slot_at INTEGER NOT NULL,connection_id TEXT NOT NULL,source_id TEXT NOT NULL,copy_id TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',schedule_at INTEGER NOT NULL,generate_at INTEGER NOT NULL,
 workflow_id TEXT NOT NULL DEFAULT '',request_json TEXT NOT NULL DEFAULT '',assets_json TEXT NOT NULL DEFAULT '[]',
 remote_batch TEXT NOT NULL DEFAULT '',remote_task TEXT NOT NULL DEFAULT '',video_id TEXT NOT NULL DEFAULT '',
 published_at INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',last_checked INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 UNIQUE(pilot_id,slot_at,connection_id)
);
CREATE INDEX photo_job_due ON photo_jobs(state,generate_at,schedule_at);
CREATE INDEX photo_job_direction ON photo_jobs(owner,direction_id,schedule_at,id);
CREATE INDEX photo_job_remote ON photo_jobs(state,last_checked);
CREATE TABLE photo_source_uses (
 owner TEXT NOT NULL,direction_id TEXT NOT NULL,connection_id TEXT NOT NULL,source_id TEXT NOT NULL,
 job_id TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,
 PRIMARY KEY(owner,direction_id,connection_id,source_id)
);
CREATE TABLE photo_import_keys (
 direction_id TEXT PRIMARY KEY,owner TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,prefix TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE TABLE photo_dispatch_lock (id INTEGER PRIMARY KEY,lease_until INTEGER NOT NULL DEFAULT 0);
INSERT INTO photo_dispatch_lock(id) VALUES(1);
ALTER TABLE photo_dispatch_lock ADD COLUMN token TEXT NOT NULL DEFAULT '';
CREATE INDEX photo_job_copy ON photo_jobs(copy_id,state);
CREATE UNIQUE INDEX photo_job_video ON photo_jobs(connection_id,video_id) WHERE video_id<>'';
-- Guards apply only to new tables. Legacy jobs/pilots are never rewritten.
CREATE TRIGGER photo_pilot_start_guard BEFORE UPDATE OF status ON photo_pilots WHEN NEW.status='active' BEGIN
 SELECT RAISE(ABORT,'账号仍被旧心理学自动运营占用') WHERE EXISTS(SELECT 1 FROM psychology_autopilots p WHERE p.status IN ('active','paused') AND p.ends_at>CAST(strftime('%s','now') AS INTEGER)*1000 AND
 (p.group_id=NEW.group_id OR EXISTS(SELECT 1 FROM psychology_autopilot_accounts a WHERE a.autopilot_id=p.id AND a.connection_id IN(SELECT json_extract(value,'$.id') FROM json_each(NEW.accounts_json)))));
 SELECT RAISE(ABORT,'账号已被其他图文测试占用') WHERE EXISTS(SELECT 1 FROM photo_pilots p WHERE p.id<>NEW.id AND p.status IN ('active','paused') AND
 (p.group_id=NEW.group_id OR EXISTS(SELECT 1 FROM json_each(p.accounts_json) a WHERE json_extract(a.value,'$.id') IN(SELECT json_extract(value,'$.id') FROM json_each(NEW.accounts_json)))));
END;
CREATE TRIGGER photo_job_insert_guard BEFORE INSERT ON photo_jobs BEGIN
 SELECT RAISE(ABORT,'图文方向、文案或运营状态已变化') WHERE NOT EXISTS(SELECT 1 FROM photo_pilots p JOIN photo_directions d ON d.id=p.direction_id JOIN photo_copies c ON c.id=NEW.copy_id
 WHERE p.id=NEW.pilot_id AND p.status='active' AND d.enabled=1 AND d.owner=NEW.owner AND d.id=NEW.direction_id
 AND c.owner=NEW.owner AND c.direction_id=NEW.direction_id AND c.source_id=NEW.source_id AND c.enabled=1);
END;
ALTER TABLE photo_jobs ADD COLUMN assets_cleaned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX photo_job_cleanup ON photo_jobs(state,assets_cleaned,updated_at);
