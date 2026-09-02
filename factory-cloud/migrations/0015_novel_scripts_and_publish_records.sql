CREATE TABLE IF NOT EXISTS factory_novel_scripts (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL DEFAULT '',
  audio_id TEXT NOT NULL DEFAULT '',
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_factory_novel_scripts_novel ON factory_novel_scripts (novel_id);

CREATE TABLE IF NOT EXISTS factory_publish_records (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT 0,
  value_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_factory_publish_records_created ON factory_publish_records (created_at);
