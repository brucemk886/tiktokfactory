-- The owner confirmed that all existing imports are from grokbot.
-- A default also keeps in-flight legacy inserts compatible; do not touch revisions,
-- timestamps or request receipts during this additive migration.
ALTER TABLE psychology_video_hits ADD COLUMN import_source TEXT NOT NULL DEFAULT 'grokbot';
CREATE INDEX psychology_video_hits_import_source ON psychology_video_hits(owner_id, import_source, updated_at DESC, id);
