CREATE TABLE psychology_conversion_campaigns (
 project_key TEXT PRIMARY KEY,owner TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
);
-- Immutable future-effective versions; frozen jobs never change.
CREATE TABLE psychology_conversion_versions (
 project_key TEXT NOT NULL,revision INTEGER NOT NULL,owner TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),effective_at INTEGER NOT NULL,
 time_zone TEXT NOT NULL CHECK(time_zone IN ('Asia/Shanghai','America/Los_Angeles')),
 website_url TEXT NOT NULL DEFAULT 'https://deeppersonaai.com/',
 receivers_json TEXT NOT NULL DEFAULT '[]',routes_json TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,
 PRIMARY KEY(project_key,revision)
);
CREATE INDEX psychology_conversion_effective ON psychology_conversion_versions(owner,effective_at,revision);

CREATE TABLE psychology_conversion_allocations (
 item_id TEXT PRIMARY KEY,project_key TEXT NOT NULL,revision INTEGER NOT NULL,
 connection_id TEXT NOT NULL,receiver_connection_id TEXT NOT NULL,schedule_at INTEGER NOT NULL,
 base_copy_hash TEXT NOT NULL DEFAULT '',final_copy_hash TEXT NOT NULL DEFAULT '',
 route_json TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX psychology_conversion_allocations_receiver ON psychology_conversion_allocations(receiver_connection_id,schedule_at);
