CREATE TABLE IF NOT EXISTS psychology_photo_analysis_slots (
  holder TEXT PRIMARY KEY,
  lease_until INTEGER NOT NULL DEFAULT 0
);
