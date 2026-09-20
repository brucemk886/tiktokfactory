ALTER TABLE psychology_template_topics ADD COLUMN reveal_comment TEXT NOT NULL DEFAULT '';
CREATE TABLE psychology_comment_templates (
 template TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, delay_minutes INTEGER NOT NULL DEFAULT 120,
 caption TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE psychology_scheduled_comments (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, created_by TEXT NOT NULL, template TEXT NOT NULL,
 connection_id TEXT NOT NULL, account_name TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
 text TEXT NOT NULL, delay_minutes INTEGER NOT NULL, caption TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'waiting_publish', video_id TEXT NOT NULL DEFAULT '', video_url TEXT NOT NULL DEFAULT '',
 published_at INTEGER NOT NULL DEFAULT 0, time_basis TEXT NOT NULL DEFAULT '', due_at INTEGER NOT NULL DEFAULT 0,
 next_check_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
 error TEXT NOT NULL DEFAULT '', comment_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_psychology_comments_due ON psychology_scheduled_comments(status,next_check_at,lease_until);
CREATE INDEX idx_psychology_comments_owner ON psychology_scheduled_comments(created_by,created_at);
