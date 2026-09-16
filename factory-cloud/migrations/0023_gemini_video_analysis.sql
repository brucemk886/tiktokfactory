CREATE TABLE factory_video_analyses (
  id TEXT PRIMARY KEY,
  owner_username TEXT NOT NULL,
  model TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  result_text TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL,
  google_file_name TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_factory_video_analyses_owner ON factory_video_analyses(owner_username, created_at DESC);
