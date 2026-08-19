CREATE TABLE factory_novels (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'NovelMaster',
  promotion_code TEXT NOT NULL DEFAULT '',
  promotion_copy TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  selling_point TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  source_content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_factory_novels_title ON factory_novels (title);
CREATE INDEX idx_factory_novels_featured_created ON factory_novels (featured, created_at);
