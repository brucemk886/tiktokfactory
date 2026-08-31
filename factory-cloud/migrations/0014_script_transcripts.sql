CREATE TABLE factory_script_transcripts (
  script_id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  words_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_script_transcripts_novel ON factory_script_transcripts (novel_id);
