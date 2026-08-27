ALTER TABLE factory_peer_hits ADD COLUMN audio_id TEXT NOT NULL DEFAULT '';
ALTER TABLE factory_peer_hits ADD COLUMN audio_name TEXT NOT NULL DEFAULT '';
ALTER TABLE factory_peer_hits ADD COLUMN audio_size INTEGER NOT NULL DEFAULT 0;
