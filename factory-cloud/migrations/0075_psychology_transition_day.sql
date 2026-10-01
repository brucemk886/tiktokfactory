CREATE TABLE psychology_transition_days (
 id TEXT PRIMARY KEY,owner TEXT NOT NULL,policy_id TEXT NOT NULL,policy_revision INTEGER NOT NULL,
 operating_date TEXT NOT NULL CHECK(operating_date='2026-10-01'),time_zone TEXT NOT NULL CHECK(time_zone='America/Los_Angeles'),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),run_lease_until INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,
 UNIQUE(owner,operating_date)
);
CREATE TABLE psychology_transition_members (
 transition_id TEXT NOT NULL,connection_id TEXT NOT NULL,group_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('review','strong','normal')),snapshot_revision INTEGER NOT NULL,
 snapshot_effective_at INTEGER NOT NULL,bound_at INTEGER NOT NULL,name TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(transition_id,connection_id)
);
CREATE TABLE psychology_transition_slots (
 transition_id TEXT NOT NULL,group_id TEXT NOT NULL,round INTEGER NOT NULL CHECK(round IN (1,2)),slot_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',lease_until INTEGER NOT NULL DEFAULT 0,
 planned INTEGER NOT NULL DEFAULT 0,batch_ids_json TEXT NOT NULL DEFAULT '[]',detail_json TEXT NOT NULL DEFAULT '{}',updated_at INTEGER NOT NULL,
 PRIMARY KEY(transition_id,group_id,round)
);
CREATE TABLE psychology_transition_claims (
 transition_id TEXT NOT NULL,connection_id TEXT NOT NULL,operating_date TEXT NOT NULL,round INTEGER NOT NULL CHECK(round IN (1,2)),
 item_id TEXT NOT NULL UNIQUE,source_key TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(connection_id,operating_date,round),UNIQUE(transition_id,connection_id,source_key)
);
