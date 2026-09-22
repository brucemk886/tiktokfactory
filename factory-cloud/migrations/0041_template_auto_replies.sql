ALTER TABLE psychology_comment_templates ADD COLUMN auto_reply_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_comment_templates ADD COLUMN reply_hours INTEGER NOT NULL DEFAULT 48;
ALTER TABLE psychology_comment_templates ADD COLUMN reply_max INTEGER NOT NULL DEFAULT 100;
ALTER TABLE psychology_scheduled_comments ADD COLUMN reply_config_json TEXT NOT NULL DEFAULT '{}';
