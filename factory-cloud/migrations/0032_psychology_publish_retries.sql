ALTER TABLE factory_jobs ADD COLUMN available_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE factory_jobs ADD COLUMN auto_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE factory_jobs ADD COLUMN retry_history_json TEXT NOT NULL DEFAULT '[]';
CREATE INDEX factory_jobs_available ON factory_jobs(status,available_at,created_at);
-- Backfill missed failure records only. Historical jobs are never re-enqueued.
INSERT OR IGNORE INTO factory_publish_records(id,created_at,value_json)
SELECT 'psychology:'||i.id,j.updated_at,json_object(
 'id','psychology:'||i.id,'autoTaskId',i.id,'autoBatchId',i.batch_id,
 'connectionId',i.connection_id,'title',j.title,'fileName',j.title,
 'createdAt',j.updated_at,'updatedAt',j.updated_at,'scheduleAt',i.schedule_at*1000,
 'status','failed','provider','official','source','official-tiktok',
 'mediaType',json_extract(b.config_json,'$.mediaType'),
 'error',j.error,'errorMessage',j.error,'publishError',j.error,
 'note','历史提交失败，待人工处理；未自动重新发布')
FROM psychology_publish_items i JOIN psychology_publish_batches b ON b.id=i.batch_id
JOIN factory_jobs j ON j.id=i.job_id
WHERE i.deleted_at=0 AND i.receipt_json='{}' AND j.status='failed'
 AND (j.type='official-publish' OR json_extract(j.payload_json,'$.photoAutomation')=1)
 AND NOT EXISTS (SELECT 1 FROM factory_publish_records r WHERE json_extract(r.value_json,'$.autoTaskId')=i.id);
