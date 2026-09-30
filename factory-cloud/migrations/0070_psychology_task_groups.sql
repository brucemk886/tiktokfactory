CREATE TABLE psychology_task_group_policies (
 id TEXT PRIMARY KEY,project_key TEXT NOT NULL UNIQUE,owner TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),revision INTEGER NOT NULL DEFAULT 1,
 starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,cycle_days INTEGER NOT NULL DEFAULT 7 CHECK(cycle_days=7),
 review_days INTEGER NOT NULL DEFAULT 3 CHECK(review_days=3),last_review_at INTEGER NOT NULL DEFAULT 0,
 next_review_at INTEGER NOT NULL,review_target INTEGER NOT NULL DEFAULT 60 CHECK(review_target BETWEEN 5 AND 60),
 admit_new_accounts INTEGER NOT NULL DEFAULT 1 CHECK(admit_new_accounts IN (0,1)),
 source_pilot_ids_json TEXT NOT NULL DEFAULT '[]',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
);
CREATE TABLE psychology_task_group_revisions (
 policy_id TEXT NOT NULL,revision INTEGER NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(policy_id,revision)
);
CREATE TABLE psychology_task_group_cycles (
 policy_id TEXT NOT NULL,revision INTEGER NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,
 PRIMARY KEY(policy_id,revision)
);
CREATE TABLE psychology_task_group_accounts (
 policy_id TEXT NOT NULL,connection_id TEXT NOT NULL,first_seen_at INTEGER NOT NULL,
 enrolled INTEGER NOT NULL DEFAULT 0 CHECK(enrolled IN (0,1)),excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1)),
 is_new INTEGER NOT NULL DEFAULT 0 CHECK(is_new IN (0,1)),paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
 reason TEXT NOT NULL DEFAULT '',group_id TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT '',
 updated_at INTEGER NOT NULL,PRIMARY KEY(policy_id,connection_id)
);
CREATE TABLE psychology_task_group_snapshots (
 policy_id TEXT NOT NULL,connection_id TEXT NOT NULL,effective_at INTEGER NOT NULL,revision INTEGER NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('review','strong','normal','rescue-hook','rescue-content','diagnostic','observing','launch')),
 account_pool TEXT NOT NULL,group_id TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',paused INTEGER NOT NULL DEFAULT 0,
 reason TEXT NOT NULL DEFAULT '',PRIMARY KEY(policy_id,connection_id,effective_at)
);
CREATE INDEX psychology_task_group_snapshot_lookup ON psychology_task_group_snapshots(policy_id,connection_id,effective_at DESC);
ALTER TABLE psychology_autopilots ADD COLUMN task_group_policy_id TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_autopilots ADD COLUMN task_group_managed INTEGER NOT NULL DEFAULT 0;
CREATE TABLE psychology_task_group_allocations (
 policy_id TEXT NOT NULL,connection_id TEXT NOT NULL,beijing_date TEXT NOT NULL,
 round INTEGER NOT NULL CHECK(round BETWEEN 0 AND 2),item_id TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,
 PRIMARY KEY(policy_id,connection_id,beijing_date,round)
);
