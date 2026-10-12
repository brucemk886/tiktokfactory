ALTER TABLE psychology_autopilots ADD COLUMN campaign_slots_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE psychology_autopilots ADD COLUMN account_ids_json TEXT NOT NULL DEFAULT '[]';
