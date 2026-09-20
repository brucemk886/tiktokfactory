ALTER TABLE psychology_publish_items ADD COLUMN photo_backups_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE psychology_publish_groups ADD COLUMN asset_recovery_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_publish_groups ADD COLUMN ready_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX psychology_items_source_account ON psychology_publish_items(source_id, connection_id);
CREATE TABLE psychology_peer_account_usage(source_id TEXT NOT NULL, connection_id TEXT NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY(source_id,connection_id));
INSERT OR IGNORE INTO psychology_peer_account_usage(source_id,connection_id,item_id)
 SELECT i.source_id,i.connection_id,i.id FROM psychology_publish_items i JOIN factory_jobs j ON j.id=i.job_id WHERE json_extract(j.payload_json,'$.peerSource') IS NOT NULL AND i.deleted_at=0;
UPDATE psychology_publish_groups SET ready_at=(SELECT COALESCE(NULLIF(MAX(j.updated_at),0),unixepoch()*1000) FROM psychology_publish_items i LEFT JOIN factory_jobs j ON j.id=i.job_id WHERE i.publish_group_id=psychology_publish_groups.id AND i.ready_json<>'{}')
 WHERE status='waiting' AND EXISTS(SELECT 1 FROM psychology_publish_items i WHERE i.publish_group_id=psychology_publish_groups.id AND i.ready_json<>'{}');
