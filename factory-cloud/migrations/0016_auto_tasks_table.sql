CREATE TABLE IF NOT EXISTS factory_auto_tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  value_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_factory_auto_tasks_live ON factory_auto_tasks (deleted, created_at);
