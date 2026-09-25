-- Derived, per-account report projection. Raw archive objects remain authoritative.
CREATE TABLE official_report_video_cache (
 account_key TEXT PRIMARY KEY,
 synced_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 videos_json TEXT NOT NULL
);
