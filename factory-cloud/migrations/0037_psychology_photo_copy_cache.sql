CREATE TABLE IF NOT EXISTS psychology_photo_copy_cache (
  owner TEXT NOT NULL,
  source_key TEXT NOT NULL,
  copy_json TEXT NOT NULL DEFAULT '',
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, source_key)
);
