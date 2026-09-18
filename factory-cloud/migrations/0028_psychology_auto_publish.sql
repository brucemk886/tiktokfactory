CREATE TABLE IF NOT EXISTS psychology_publish_batches (
  id TEXT PRIMARY KEY, created_by TEXT NOT NULL, config_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS psychology_publish_batches_owner ON psychology_publish_batches(created_by, created_at DESC);
CREATE TABLE IF NOT EXISTS psychology_publish_items (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES psychology_publish_batches(id),
  source_id TEXT NOT NULL, job_id TEXT NOT NULL, connection_id TEXT NOT NULL, schedule_at INTEGER NOT NULL,
  photo_assets_json TEXT NOT NULL DEFAULT '{}', receipt_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS psychology_publish_items_batch ON psychology_publish_items(batch_id);
