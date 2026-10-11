-- Optional per-plan source. Existing plans stay on the copy library and do not mention receivers.
ALTER TABLE psychology_autopilots ADD COLUMN content_source TEXT NOT NULL DEFAULT 'library' CHECK(content_source IN ('library','video-hits'));
ALTER TABLE psychology_autopilots ADD COLUMN mention_receivers INTEGER NOT NULL DEFAULT 0 CHECK(mention_receivers IN (0,1));
