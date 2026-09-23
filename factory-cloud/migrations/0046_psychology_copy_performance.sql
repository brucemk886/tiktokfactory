-- Daily rollup of how each viral post's original ('' variant) and each
-- rewrite performed, read by the copy-library evolution draw.
CREATE TABLE IF NOT EXISTS psychology_copy_performance (
  owner TEXT NOT NULL,
  source_key TEXT NOT NULL,
  variant_id TEXT NOT NULL DEFAULT '',
  posts INTEGER NOT NULL DEFAULT 0,
  mature INTEGER NOT NULL DEFAULT 0,
  views_sum INTEGER NOT NULL DEFAULT 0,
  avg_views REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner, source_key, variant_id)
);
