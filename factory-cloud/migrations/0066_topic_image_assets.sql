CREATE TABLE factory_assets (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, purpose TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, bytes INTEGER NOT NULL,
 width INTEGER NOT NULL, height INTEGER NOT NULL, sha256 TEXT NOT NULL,
 source TEXT NOT NULL, generation_model TEXT NOT NULL, generation_prompt TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'ready', created_at INTEGER NOT NULL
);
CREATE INDEX factory_assets_owner ON factory_assets(owner_id,created_at);
CREATE TABLE factory_ai_operations (
 owner_id TEXT NOT NULL, request_id TEXT NOT NULL, input_hash TEXT NOT NULL,
 input_json TEXT NOT NULL, status TEXT NOT NULL, asset_id TEXT NOT NULL,
 workflow_id TEXT NOT NULL UNIQUE, import_request_id TEXT NOT NULL,
 provider_request_id TEXT, result_json TEXT, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,request_id)
);
ALTER TABLE psychology_template_topics ADD COLUMN cover_asset_id TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_template_topics ADD COLUMN image_asset_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE factory_mcp_connections ADD COLUMN scopes_json TEXT NOT NULL DEFAULT '["factory.read"]';
