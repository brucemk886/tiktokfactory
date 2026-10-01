-- True observations start at rollout; no fabricated historical pool backfill.
CREATE TABLE psychology_pool_observation_checks (
 project_key TEXT NOT NULL,check_key TEXT NOT NULL,observed_at INTEGER NOT NULL,
 operating_date TEXT NOT NULL,time_zone TEXT NOT NULL,group_ids_json TEXT NOT NULL,capture_token TEXT NOT NULL,
 PRIMARY KEY(project_key,check_key)
);
CREATE INDEX psychology_pool_observation_dates ON psychology_pool_observation_checks(project_key,time_zone,observed_at DESC);
CREATE TABLE psychology_account_observations (
 project_key TEXT NOT NULL,check_key TEXT NOT NULL,account_key TEXT NOT NULL,group_id TEXT NOT NULL,
 pool TEXT NOT NULL CHECK(pool IN ('strong','normal','rescue-hook','rescue-content','diagnostic','observing')),
 samples INTEGER NOT NULL,median_views REAL,high_rate REAL,completion REAL,
 PRIMARY KEY(project_key,check_key,account_key),
 FOREIGN KEY(project_key,check_key) REFERENCES psychology_pool_observation_checks(project_key,check_key)
);