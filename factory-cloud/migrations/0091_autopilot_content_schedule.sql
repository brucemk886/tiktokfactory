-- Optional per-slot ready-material source. Empty keeps the plan-wide legacy source.
ALTER TABLE psychology_autopilots ADD COLUMN content_schedule_json TEXT NOT NULL DEFAULT '[]';
