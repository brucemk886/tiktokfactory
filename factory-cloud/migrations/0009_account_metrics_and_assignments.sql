ALTER TABLE official_accounts_latest ADD COLUMN video_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE official_accounts_latest ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE official_accounts_latest ADD COLUMN likes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE official_accounts_latest ADD COLUMN comments INTEGER NOT NULL DEFAULT 0;
ALTER TABLE official_accounts_latest ADD COLUMN shares INTEGER NOT NULL DEFAULT 0;
ALTER TABLE official_accounts_latest ADD COLUMN reach INTEGER NOT NULL DEFAULT 0;

CREATE TABLE official_account_assignments (
  account_key TEXT PRIMARY KEY,
  group_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_official_account_assignments_group ON official_account_assignments (group_id);
