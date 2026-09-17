ALTER TABLE psychology_peer_hits ADD COLUMN media_type_locked INTEGER NOT NULL DEFAULT 0 CHECK (media_type_locked IN (0, 1));
