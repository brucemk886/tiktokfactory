-- Durable planning work is separate from immutable publishing jobs.
CREATE TABLE psychology_schedule_work (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, window_at INTEGER NOT NULL,
 pilot_id TEXT NOT NULL DEFAULT '', slot_at INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'queued', phase INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0,
 available_at INTEGER NOT NULL DEFAULT 0, dispatched_at INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, detail TEXT NOT NULL DEFAULT '',
 payload_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX psychology_schedule_work_due ON psychology_schedule_work(status,available_at,lease_until);
CREATE INDEX psychology_schedule_work_owner ON psychology_schedule_work(owner,slot_at);
CREATE UNIQUE INDEX psychology_schedule_one_slot ON psychology_schedule_work(pilot_id,slot_at) WHERE kind='slot';
CREATE TABLE psychology_schedule_members (
 work_id TEXT NOT NULL REFERENCES psychology_schedule_work(id), connection_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
 item_id TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL,
 PRIMARY KEY(work_id,connection_id)
);
CREATE INDEX psychology_schedule_members_status ON psychology_schedule_members(work_id,status,ordinal);
CREATE TABLE psychology_schedule_commits (
 batch_id TEXT PRIMARY KEY, work_id TEXT NOT NULL, lease_token TEXT NOT NULL, checked_at INTEGER NOT NULL
);
CREATE TRIGGER psychology_schedule_commit_fence BEFORE INSERT ON psychology_schedule_commits BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM psychology_schedule_work w JOIN psychology_autopilots p ON p.id=w.pilot_id
  WHERE w.id=NEW.work_id AND w.status='running' AND w.lease_token=NEW.lease_token
  AND w.lease_until>NEW.checked_at AND p.status='active' AND p.ends_at>w.slot_at
 ) THEN RAISE(ABORT,'SCHEDULER_LEASE_LOST') END;
END;
CREATE TABLE psychology_schedule_alerts (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, work_id TEXT NOT NULL DEFAULT '',
 level TEXT NOT NULL, message TEXT NOT NULL, opened_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL, resolved_at INTEGER NOT NULL DEFAULT 0, notified_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX psychology_schedule_alerts_owner ON psychology_schedule_alerts(owner,resolved_at);
