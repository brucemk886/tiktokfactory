CREATE TABLE psychology_generation_plans (
  job_id TEXT PRIMARY KEY REFERENCES factory_jobs(id) ON DELETE CASCADE,
  policy TEXT NOT NULL,
  generation_at INTEGER NOT NULL,
  initial_generation_at INTEGER NOT NULL,
  lead_ms INTEGER NOT NULL,
  required_lead_ms INTEGER NOT NULL,
  evaluated_at INTEGER NOT NULL,
  plan_json TEXT NOT NULL,
  dispatch_at INTEGER NOT NULL DEFAULT 0,
  dispatch_lease_until INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX psychology_generation_due ON psychology_generation_plans(dispatch_at,started_at,generation_at);
CREATE INDEX psychology_generation_service_samples ON factory_jobs(completed_at DESC,id DESC)
  WHERE status='done' AND json_extract(payload_json,'$.cloudPhotoRender')=1 AND json_extract(payload_json,'$.photoAutomation')=1;
