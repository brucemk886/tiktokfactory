CREATE TABLE IF NOT EXISTS psychology_template_topic_keys (
  owner_id TEXT PRIMARY KEY REFERENCES factory_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
