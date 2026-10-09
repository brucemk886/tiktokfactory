-- Different import agents may keep independent material for the same external ID.
-- Rebuild only the unique constraint. Preserve IDs, revisions, media, jobs and receipts.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE psychology_video_hits_by_importer (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, external_id TEXT NOT NULL,
 video_url TEXT NOT NULL, title TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
 script TEXT NOT NULL DEFAULT '', video_data_json TEXT NOT NULL DEFAULT '{}',
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 archived_at INTEGER NOT NULL DEFAULT 0, originals_cleaned_at INTEGER NOT NULL DEFAULT 0,
 import_source TEXT NOT NULL DEFAULT 'grokbot',
 UNIQUE(owner_id, import_source, external_id)
);
INSERT INTO psychology_video_hits_by_importer
 (id,owner_id,external_id,video_url,title,caption,script,video_data_json,revision,created_at,updated_at,archived_at,originals_cleaned_at,import_source)
 SELECT id,owner_id,external_id,video_url,title,caption,script,video_data_json,revision,created_at,updated_at,archived_at,originals_cleaned_at,import_source FROM psychology_video_hits;
DROP TABLE psychology_video_hits;
ALTER TABLE psychology_video_hits_by_importer RENAME TO psychology_video_hits;
CREATE INDEX psychology_video_hits_owner ON psychology_video_hits(owner_id, updated_at DESC, id);
CREATE INDEX psychology_video_hits_import_source ON psychology_video_hits(owner_id, import_source, updated_at DESC, id);
PRAGMA defer_foreign_keys=OFF;
