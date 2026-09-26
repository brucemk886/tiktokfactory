CREATE TABLE psychology_management_keys (
 owner_id TEXT PRIMARY KEY REFERENCES factory_users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL,
 scopes_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE psychology_report_views (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, module TEXT NOT NULL CHECK(module IN ('effects','operations')),
 name TEXT NOT NULL, query_json TEXT NOT NULL, creation_hash TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX psychology_report_views_owner ON psychology_report_views(owner,module,created_at,id);
CREATE TABLE psychology_managed_styles (
 owner TEXT NOT NULL, id TEXT NOT NULL, definition_json TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), revision INTEGER NOT NULL DEFAULT 1,
 creation_hash TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner,id)
);
ALTER TABLE psychology_autopilots ADD COLUMN api_request_hash TEXT NOT NULL DEFAULT '';
