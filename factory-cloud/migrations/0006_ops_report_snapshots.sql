CREATE TABLE official_ops_reports (
  id TEXT PRIMARY KEY,
  module_key TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_name TEXT NOT NULL DEFAULT '',
  group_id TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  period TEXT NOT NULL,
  date_key TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_ops_reports_scope
  ON official_ops_reports (module_key, project_id, group_id, period, date_key);

CREATE INDEX idx_ops_reports_lookup
  ON official_ops_reports (module_key, period, date_key);
