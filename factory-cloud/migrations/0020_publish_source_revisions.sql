-- Per-source revision watermark so v2 publish-record sync can ignore
-- duplicate or older events from the same worker database identity.
CREATE TABLE IF NOT EXISTS factory_publish_source_revisions (
  source_store_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  applied_revision INTEGER NOT NULL,
  applied_seq INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source_store_id, record_key)
);

CREATE INDEX IF NOT EXISTS idx_factory_publish_source_revisions_updated
  ON factory_publish_source_revisions (updated_at);
