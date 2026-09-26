CREATE TABLE factory_ai_keys (
 id TEXT PRIMARY KEY CHECK(id='project'), owner_id TEXT NOT NULL REFERENCES factory_users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE factory_ai_requests (
 owner_id TEXT NOT NULL, request_id TEXT NOT NULL, module TEXT NOT NULL, action TEXT NOT NULL,
 input_hash TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('processing','done')),
 response_json TEXT NOT NULL DEFAULT '', response_status INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,request_id)
);
CREATE INDEX factory_ai_requests_created ON factory_ai_requests(created_at);
