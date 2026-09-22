ALTER TABLE psychology_template_topics ADD COLUMN reply_options_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE psychology_reply_watches (
 id TEXT PRIMARY KEY,created_by TEXT NOT NULL,connection_id TEXT NOT NULL,account_name TEXT NOT NULL,video_id TEXT NOT NULL,
 topic_id TEXT NOT NULL,title TEXT NOT NULL,answers_json TEXT NOT NULL,start_at INTEGER NOT NULL,end_at INTEGER NOT NULL,
 max_replies INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',cursor TEXT NOT NULL DEFAULT '0',next_scan_at INTEGER NOT NULL DEFAULT 0,dispatch_at INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,last_scan_at INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(connection_id,video_id));
CREATE INDEX idx_reply_watches_due ON psychology_reply_watches(status,next_scan_at);
CREATE TABLE psychology_reply_items (
 id TEXT PRIMARY KEY,watch_id TEXT NOT NULL REFERENCES psychology_reply_watches(id),connection_id TEXT NOT NULL,video_id TEXT NOT NULL,
 parent_comment_id TEXT NOT NULL,comment_text TEXT NOT NULL,author_name TEXT NOT NULL DEFAULT '',choice TEXT NOT NULL DEFAULT '',text TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',comment_id TEXT NOT NULL DEFAULT '',attempts INTEGER NOT NULL DEFAULT 0,next_check_at INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(connection_id,video_id,parent_comment_id));
CREATE INDEX idx_reply_items_due ON psychology_reply_items(status,next_check_at);
CREATE TABLE psychology_reply_account_locks(connection_id TEXT PRIMARY KEY,lease_token TEXT NOT NULL,lease_until INTEGER NOT NULL);
