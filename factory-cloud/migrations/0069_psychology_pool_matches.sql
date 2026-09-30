-- Immutable allocation evidence. Retries reuse the original item and decision.
CREATE TABLE psychology_pool_matches (
 item_id TEXT PRIMARY KEY,owner TEXT NOT NULL,connection_id TEXT NOT NULL,
 account_pool TEXT NOT NULL,desired_pool TEXT NOT NULL,content_pool TEXT NOT NULL,
 source_key TEXT NOT NULL,variant_id TEXT NOT NULL DEFAULT '',style_id TEXT NOT NULL,
 copy_hash TEXT NOT NULL,style_revision INTEGER NOT NULL DEFAULT 0,
 cycle_start_at INTEGER NOT NULL,day_index INTEGER NOT NULL,round INTEGER NOT NULL,
 reason TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX psychology_pool_match_cycle ON psychology_pool_matches(owner,connection_id,cycle_start_at);

