ALTER TABLE factory_video_analyses ADD COLUMN provider TEXT NOT NULL DEFAULT 'google';
ALTER TABLE factory_video_analyses ADD COLUMN provider_credits REAL NOT NULL DEFAULT 0;
