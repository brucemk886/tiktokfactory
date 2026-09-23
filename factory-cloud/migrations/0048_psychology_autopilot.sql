CREATE TABLE psychology_autopilots(
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  group_id TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  strategy TEXT NOT NULL CHECK (strategy IN ('evolve','original','rewrite')),
  slots_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','paused','ended')),
  ends_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX psychology_autopilots_live_group ON psychology_autopilots(group_id) WHERE status<>'ended';
CREATE TABLE psychology_autopilot_accounts(
  autopilot_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','paused')),
  reason TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (autopilot_id, connection_id)
);
CREATE TABLE psychology_autopilot_slots(
  autopilot_id TEXT NOT NULL,
  slot_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('creating','created','failed','skipped')),
  batch_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (autopilot_id, slot_at)
);
CREATE TABLE psychology_autopilot_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  autopilot_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX psychology_autopilot_log_by_pilot ON psychology_autopilot_log(autopilot_id, created_at);
