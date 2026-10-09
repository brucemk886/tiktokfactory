CREATE TABLE psychology_imported_photo_settings (
 owner TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 0,
 config_json TEXT NOT NULL DEFAULT '{}', enabled_at INTEGER NOT NULL DEFAULT 0,
 dispatched_at INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0,
 scan_cursor TEXT NOT NULL DEFAULT '', checked_at INTEGER NOT NULL DEFAULT 0, detail TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE psychology_imported_photo_slots (
 connection_id TEXT NOT NULL, slot_at INTEGER NOT NULL, owner TEXT NOT NULL, revision INTEGER NOT NULL,
 source_id TEXT NOT NULL, version INTEGER NOT NULL, item_id TEXT NOT NULL UNIQUE, receiver_id TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(connection_id,slot_at)
);
CREATE INDEX psychology_imported_photo_owner ON psychology_imported_photo_slots(owner,slot_at);
CREATE INDEX psychology_imported_photo_source ON psychology_imported_photo_slots(connection_id,source_id,slot_at);
CREATE TABLE psychology_imported_photo_skips (
 owner TEXT NOT NULL, source_id TEXT NOT NULL, version INTEGER NOT NULL, revision INTEGER NOT NULL,
 retry_at INTEGER NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(owner,source_id,version)
);
