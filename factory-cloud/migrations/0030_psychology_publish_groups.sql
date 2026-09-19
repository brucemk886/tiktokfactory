ALTER TABLE psychology_publish_items ADD COLUMN publish_group_id TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_publish_items ADD COLUMN ready_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX psychology_publish_items_group ON psychology_publish_items(publish_group_id);
CREATE TABLE psychology_publish_groups (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES psychology_publish_batches(id),
  ordinal INTEGER NOT NULL, expected_count INTEGER NOT NULL CHECK(expected_count BETWEEN 1 AND 20),
  status TEXT NOT NULL DEFAULT 'waiting', request_json TEXT NOT NULL DEFAULT '{}',
  response_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0, UNIQUE(batch_id,ordinal)
);
