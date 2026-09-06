CREATE TABLE IF NOT EXISTS factory_novel_exceptions (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  source_instance_id TEXT NOT NULL DEFAULT '',
  source_revision TEXT NOT NULL DEFAULT '',
  event_id TEXT NOT NULL DEFAULT '',
  attempt_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'warning',
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  source_status TEXT NOT NULL DEFAULT '',
  novel_id TEXT NOT NULL DEFAULT '',
  script_id TEXT NOT NULL DEFAULT '',
  audio_id TEXT NOT NULL DEFAULT '',
  connection_id TEXT NOT NULL DEFAULT '',
  worker_id TEXT NOT NULL DEFAULT '',
  local_task_id TEXT NOT NULL DEFAULT '',
  cloud_job_id TEXT NOT NULL DEFAULT '',
  remote_batch_id TEXT NOT NULL DEFAULT '',
  remote_task_id TEXT NOT NULL DEFAULT '',
  publish_record_id TEXT NOT NULL DEFAULT '',
  video_id TEXT NOT NULL DEFAULT '',
  condition_state TEXT NOT NULL DEFAULT 'active',
  workflow_state TEXT NOT NULL DEFAULT 'open',
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_checked_at INTEGER NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  resolved_at INTEGER NOT NULL DEFAULT 0,
  ignored_until INTEGER NOT NULL DEFAULT 0,
  ignore_reason TEXT NOT NULL DEFAULT '',
  resolved_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_factory_novel_exceptions_list
  ON factory_novel_exceptions (workflow_state, severity, first_seen_at, id);
CREATE INDEX IF NOT EXISTS idx_factory_novel_exceptions_novel
  ON factory_novel_exceptions (novel_id, first_seen_at);
CREATE INDEX IF NOT EXISTS idx_factory_novel_exceptions_connection
  ON factory_novel_exceptions (connection_id, workflow_state);
CREATE INDEX IF NOT EXISTS idx_factory_novel_exceptions_active_checked
  ON factory_novel_exceptions (condition_state, last_checked_at);
CREATE INDEX IF NOT EXISTS idx_factory_novel_exceptions_event
  ON factory_novel_exceptions (event_id);

CREATE TABLE IF NOT EXISTS factory_novel_exception_actions (
  id TEXT PRIMARY KEY,
  exception_id TEXT NOT NULL,
  request_id TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  from_workflow TEXT NOT NULL DEFAULT '',
  to_workflow TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_factory_novel_exception_actions_ex
  ON factory_novel_exception_actions (exception_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_factory_novel_exception_actions_request
  ON factory_novel_exception_actions (exception_id, request_id)
  WHERE request_id != '';

CREATE TABLE IF NOT EXISTS factory_novel_exception_meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
