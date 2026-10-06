CREATE TABLE psychology_website_links (
 code TEXT PRIMARY KEY,
 project_key TEXT NOT NULL,
 connection_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(project_key, connection_id)
);
CREATE TABLE psychology_website_link_days (
 code TEXT NOT NULL REFERENCES psychology_website_links(code),
 day TEXT NOT NULL,
 requests INTEGER NOT NULL DEFAULT 0,
 filtered INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(code, day)
);
