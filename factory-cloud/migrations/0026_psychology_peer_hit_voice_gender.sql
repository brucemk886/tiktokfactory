ALTER TABLE psychology_peer_hits ADD COLUMN voice_gender TEXT NOT NULL DEFAULT 'male'
  CHECK (voice_gender IN ('male', 'female'));
