-- Secondary index from hub task id / external ref to a publish record id, so a
-- webhook receipt resolves its record with one primary-key read.
CREATE TABLE IF NOT EXISTS factory_publish_record_refs (
  ref TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_factory_publish_record_refs_record ON factory_publish_record_refs (record_id);

-- Every publish.completed / publish.failed receipt from the hub. Receipts that
-- arrive before the local worker has uploaded the record stay unapplied and
-- are picked up by the next record sync.
CREATE TABLE IF NOT EXISTS factory_publish_receipts (
  ref TEXT PRIMARY KEY,
  external_ref TEXT NOT NULL DEFAULT '',
  batch_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  received_at INTEGER NOT NULL DEFAULT 0,
  applied_at INTEGER NOT NULL DEFAULT 0,
  record_id TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_factory_publish_receipts_pending ON factory_publish_receipts (applied_at, received_at);
CREATE INDEX IF NOT EXISTS idx_factory_publish_receipts_external ON factory_publish_receipts (external_ref);
