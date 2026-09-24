CREATE TABLE IF NOT EXISTS psychology_copy_comparisons (
  variant_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '',
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
ALTER TABLE psychology_copy_variants ADD COLUMN quality_score REAL;
ALTER TABLE psychology_copy_variants ADD COLUMN score_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_copy_variants ADD COLUMN comparison_json TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_psychology_variant_score ON psychology_copy_variants(owner,source_key,deleted_at,quality_score DESC,created_at DESC);
