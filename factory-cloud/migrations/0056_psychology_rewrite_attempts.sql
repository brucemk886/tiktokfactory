CREATE TABLE psychology_rewrite_attempts (
 owner TEXT NOT NULL,
 source_id TEXT NOT NULL,
 started_at INTEGER NOT NULL,
 completed_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('done','failed')),
 error TEXT NOT NULL DEFAULT '',
 model TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(owner,source_id)
);
CREATE TRIGGER psychology_rewrite_attempts_source_delete AFTER DELETE ON psychology_copy_library
BEGIN
 DELETE FROM psychology_rewrite_attempts WHERE source_id=OLD.id;
END;
