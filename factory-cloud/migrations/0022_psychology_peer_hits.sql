CREATE TABLE psychology_peer_hits (
  id TEXT PRIMARY KEY,
  video_key TEXT NOT NULL UNIQUE,
  video_url TEXT NOT NULL,
  platform TEXT NOT NULL,
  video_id TEXT,
  title TEXT,
  account_name TEXT,
  account_username TEXT,
  account_url TEXT,
  cover_url TEXT,
  play_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  favorite_count INTEGER,
  share_count INTEGER,
  duration_seconds REAL,
  published_at INTEGER,
  collected_at INTEGER NOT NULL,
  video_data_json TEXT,
  source TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX psychology_peer_hits_plays ON psychology_peer_hits(play_count DESC, id DESC);
CREATE INDEX psychology_peer_hits_collected ON psychology_peer_hits(collected_at DESC, id DESC);
CREATE INDEX psychology_peer_hits_published ON psychology_peer_hits(published_at DESC, id DESC);
CREATE TABLE psychology_peer_hit_keys (
  owner_id TEXT PRIMARY KEY REFERENCES factory_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
