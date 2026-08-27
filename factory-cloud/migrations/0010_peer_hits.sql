CREATE TABLE factory_peer_hits (
  id TEXT PRIMARY KEY,
  video_key TEXT NOT NULL UNIQUE,
  video_url TEXT NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0,
  novel_title TEXT NOT NULL DEFAULT '',
  novel_id TEXT NOT NULL DEFAULT '',
  factory_novel_id TEXT NOT NULL DEFAULT '',
  video_data_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'grokbot',
  imported_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_peer_hits_play ON factory_peer_hits (play_count DESC, updated_at DESC);
CREATE INDEX idx_peer_hits_novel ON factory_peer_hits (novel_id, factory_novel_id);
