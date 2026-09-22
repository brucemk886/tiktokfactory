CREATE TABLE psychology_style_bindings(owner TEXT NOT NULL,kind TEXT NOT NULL,target_id TEXT NOT NULL,styles_json TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,kind,target_id));
CREATE TABLE psychology_copy_variants(id TEXT PRIMARY KEY,owner TEXT NOT NULL,external_id TEXT NOT NULL,source_key TEXT NOT NULL,title TEXT NOT NULL,caption TEXT NOT NULL,pages_json TEXT NOT NULL,fingerprint TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,UNIQUE(owner,external_id));
CREATE INDEX psychology_copy_variants_owner ON psychology_copy_variants(owner,enabled,created_at);
CREATE TABLE psychology_creative_snapshots(item_id TEXT PRIMARY KEY,source_key TEXT NOT NULL,variant_id TEXT NOT NULL DEFAULT '',style_id TEXT NOT NULL DEFAULT '',copy_hash TEXT NOT NULL DEFAULT '',copy_json TEXT NOT NULL DEFAULT '{}');
CREATE INDEX psychology_creative_copy ON psychology_creative_snapshots(copy_hash);
