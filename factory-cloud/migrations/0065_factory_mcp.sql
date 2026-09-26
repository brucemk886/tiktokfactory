CREATE TABLE IF NOT EXISTS factory_mcp_connections (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_name TEXT NOT NULL,
 created_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_factory_mcp_owner ON factory_mcp_connections(owner_id,created_at DESC);
