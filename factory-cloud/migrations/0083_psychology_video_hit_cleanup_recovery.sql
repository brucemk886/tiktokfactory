-- Fence late upload compensation against stale GC acknowledgments.
ALTER TABLE psychology_video_hit_assets ADD COLUMN cleanup_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_hit_videos ADD COLUMN cleanup_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_video_assets ADD COLUMN cleanup_generation INTEGER NOT NULL DEFAULT 0;
-- Retain the original worker-reported location even after configuration changes/job pruning.
ALTER TABLE psychology_video_hit_local_files ADD COLUMN output_path TEXT NOT NULL DEFAULT '';
UPDATE psychology_video_hit_local_files SET output_path=COALESCE((SELECT json_extract(j.result_json,'$.results[0].outputPath') FROM factory_jobs j WHERE j.id=job_id),'');
DROP TRIGGER psychology_video_hit_local_file;
CREATE TRIGGER psychology_video_hit_local_file AFTER UPDATE OF result_json ON factory_jobs WHEN NEW.type='psychology-video-remix' AND NEW.status='done' AND NEW.worker_id<>'' BEGIN
 INSERT OR IGNORE INTO psychology_video_hit_local_files(job_id,owner_id,source_id,version,worker_id,file_name,created_at,output_path) SELECT NEW.id,u.id,json_extract(NEW.payload_json,'$.videoRemix.sourceId'),json_extract(NEW.payload_json,'$.videoRemix.version'),NEW.worker_id,NEW.id||'.mp4',NEW.updated_at,COALESCE(json_extract(NEW.result_json,'$.results[0].outputPath'),'') FROM factory_users u WHERE u.username=NEW.created_by AND json_extract(NEW.result_json,'$.results[0].fileName')=NEW.id||'.mp4';
END;
