ALTER TABLE psychology_peer_hits ADD COLUMN topics_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE psychology_peer_hits ADD COLUMN comments_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE psychology_peer_hits ADD COLUMN metrics_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_peer_hits ADD COLUMN prev_play_count INTEGER;

CREATE TABLE psychology_peer_watch_accounts (
  username TEXT PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
