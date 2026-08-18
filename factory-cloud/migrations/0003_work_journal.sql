CREATE TABLE work_journal_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  date_key TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  mindmap_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_work_journal_kind_date ON work_journal_entries (kind, date_key DESC, updated_at DESC);
