ALTER TABLE psychology_copy_library ADD COLUMN auto_extract INTEGER NOT NULL DEFAULT 1 CHECK(auto_extract IN (0,1));
UPDATE psychology_copy_library SET auto_extract=0,
 status=CASE WHEN status='running' THEN 'failed' ELSE status END,
 attempt=attempt+CASE WHEN status='running' THEN 1 ELSE 0 END,
 error=CASE WHEN status='running' THEN '历史同行爆款已停止自动提取，请通过 Grokbot 处理。' ELSE error END,
 workflow_id=CASE WHEN status='running' THEN '' ELSE workflow_id END,
 payload_json=CASE WHEN status='running' THEN '{}' ELSE payload_json END,
 started_at=CASE WHEN status='running' THEN 0 ELSE started_at END,
 dispatch_at=CASE WHEN status='running' THEN 0 ELSE dispatch_at END
 WHERE status IN ('queued','running','failed');
