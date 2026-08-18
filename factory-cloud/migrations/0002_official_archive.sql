CREATE TABLE official_accounts_latest (
  account_key TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL DEFAULT '',
  synced_at INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  profile_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE official_videos_latest (
  video_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  snapshot_date TEXT NOT NULL DEFAULT '',
  synced_at INTEGER NOT NULL DEFAULT 0,
  create_time INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  video_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (video_id, account_key)
);

CREATE INDEX idx_official_videos_account ON official_videos_latest (account_key, create_time DESC);

CREATE TABLE official_archive_meta (
  id TEXT PRIMARY KEY,
  archive_date TEXT NOT NULL DEFAULT '',
  archive_at INTEGER NOT NULL DEFAULT 0,
  account_count INTEGER NOT NULL DEFAULT 0,
  video_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT ''
);
