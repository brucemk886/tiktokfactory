ALTER TABLE factory_jobs ADD COLUMN cloud_dispatch_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE factory_jobs ADD COLUMN cloud_lease_until INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_cloud_photo_dispatch ON factory_jobs(status,available_at,cloud_dispatch_at)
WHERE json_extract(payload_json,'$.cloudPhotoRender')=1;
