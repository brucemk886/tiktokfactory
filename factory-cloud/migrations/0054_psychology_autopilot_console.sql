ALTER TABLE psychology_autopilots ADD COLUMN stop_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_autopilots ADD COLUMN last_run_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_autopilot_accounts ADD COLUMN stop_pending INTEGER NOT NULL DEFAULT 0;
