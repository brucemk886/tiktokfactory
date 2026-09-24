ALTER TABLE psychology_autopilots ADD COLUMN pending_slots_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE psychology_autopilots ADD COLUMN slots_effective_at INTEGER NOT NULL DEFAULT 0;
