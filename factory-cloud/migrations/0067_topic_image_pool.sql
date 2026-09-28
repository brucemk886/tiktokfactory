-- Each image is consumed by its first committed draw; topics remain reusable.
CREATE TABLE psychology_topic_image_files (object_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
INSERT INTO psychology_topic_image_files SELECT object_key,'sha256:'||sha256 FROM factory_assets WHERE status='ready';
CREATE TRIGGER topic_asset_fingerprint AFTER INSERT ON factory_assets WHEN NEW.status='ready' BEGIN
 INSERT OR IGNORE INTO psychology_topic_image_files VALUES(NEW.object_key,'sha256:'||NEW.sha256);
END;
CREATE TABLE psychology_topic_images (
 id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES psychology_template_topics(id),
 image_key TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '',
 fingerprint TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), created_at INTEGER NOT NULL,
 UNIQUE(topic_id,fingerprint), CHECK(image_key<>'' OR image_url<>'')
);
CREATE INDEX topic_images_inventory ON psychology_topic_images(topic_id,enabled,created_at);
CREATE TABLE psychology_topic_image_uses (
 fingerprint TEXT PRIMARY KEY, image_id TEXT NOT NULL, item_id TEXT NOT NULL, drawn_at INTEGER NOT NULL
);
CREATE VIEW psychology_topic_primary_images AS
 SELECT id AS topic_id,
 COALESCE(json_extract(CASE WHEN json_valid(content) THEN content ELSE '{}' END,'$.imageKey'),'') AS image_key,
 CASE WHEN COALESCE(json_extract(CASE WHEN json_valid(content) THEN content ELSE '{}' END,'$.imageKey'),'')<>'' THEN ''
 ELSE COALESCE(json_extract(CASE WHEN json_valid(content) THEN content ELSE '{}' END,'$.imageUrl'),'') END AS image_url,
 created_at,usage_count,last_used_at
 FROM psychology_template_topics WHERE template='psychology-target-2';
INSERT INTO psychology_topic_images
 SELECT 'image-'||lower(hex(randomblob(16))),p.topic_id,p.image_key,p.image_url,
 COALESCE(f.fingerprint,CASE WHEN p.image_key<>'' THEN 'key:'||p.image_key ELSE 'url:'||p.image_url END),1,p.created_at
 FROM psychology_topic_primary_images p LEFT JOIN psychology_topic_image_files f ON f.object_key=p.image_key
 WHERE p.image_key<>'' OR p.image_url<>'';
-- Historical usage stays consumed even if its original job was deleted.
INSERT OR IGNORE INTO psychology_topic_image_uses
 SELECT i.fingerprint,i.id,'legacy:'||p.topic_id,p.last_used_at FROM psychology_topic_images i
 JOIN psychology_topic_primary_images p ON p.topic_id=i.topic_id WHERE p.usage_count>0;
CREATE TRIGGER topic_pool_insert AFTER INSERT ON psychology_template_topics WHEN NEW.template='psychology-target-2' BEGIN
 INSERT OR IGNORE INTO psychology_topic_images
 SELECT 'image-'||lower(hex(randomblob(16))),p.topic_id,p.image_key,p.image_url,
 COALESCE(f.fingerprint,CASE WHEN p.image_key<>'' THEN 'key:'||p.image_key ELSE 'url:'||p.image_url END),1,NEW.updated_at
 FROM psychology_topic_primary_images p LEFT JOIN psychology_topic_image_files f ON f.object_key=p.image_key
 WHERE p.topic_id=NEW.id AND (p.image_key<>'' OR p.image_url<>'');
END;
CREATE TRIGGER topic_pool_update AFTER UPDATE OF content ON psychology_template_topics WHEN NEW.template='psychology-target-2' BEGIN
 INSERT OR IGNORE INTO psychology_topic_images
 SELECT 'image-'||lower(hex(randomblob(16))),p.topic_id,p.image_key,p.image_url,
 COALESCE(f.fingerprint,CASE WHEN p.image_key<>'' THEN 'key:'||p.image_key ELSE 'url:'||p.image_url END),1,NEW.updated_at
 FROM psychology_topic_primary_images p LEFT JOIN psychology_topic_image_files f ON f.object_key=p.image_key
 WHERE p.topic_id=NEW.id AND (p.image_key<>'' OR p.image_url<>'');
END;
DROP TRIGGER psychology_topic_usage_validate;
DROP TRIGGER psychology_topic_usage_count;
ALTER TABLE psychology_topic_usage RENAME TO psychology_topic_usage_old;
CREATE TABLE psychology_topic_usage (
 topic_id TEXT NOT NULL, batch_id TEXT NOT NULL, item_id TEXT PRIMARY KEY,
 template TEXT NOT NULL, revision INTEGER NOT NULL, only_unused INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, image_id TEXT NOT NULL DEFAULT ''
);
INSERT INTO psychology_topic_usage(topic_id,batch_id,item_id,template,revision,only_unused,created_at)
 SELECT topic_id,batch_id,item_id,template,revision,only_unused,created_at FROM psychology_topic_usage_old;
DROP TABLE psychology_topic_usage_old;
CREATE INDEX topic_usage_topic ON psychology_topic_usage(topic_id,batch_id);
CREATE UNIQUE INDEX topic_usage_once_per_batch ON psychology_topic_usage(topic_id,batch_id) WHERE template<>'psychology-target-2';
CREATE TRIGGER psychology_topic_usage_validate BEFORE INSERT ON psychology_topic_usage BEGIN
 SELECT RAISE(ABORT,'TOPIC_CHANGED') WHERE NOT EXISTS (
 SELECT 1 FROM psychology_template_topics WHERE id=NEW.topic_id AND template=NEW.template AND revision=NEW.revision AND enabled=1 AND deleted_at=0);
 SELECT RAISE(ABORT,'TOPIC_ALREADY_USED') WHERE NEW.template<>'psychology-target-2' AND NEW.only_unused=1 AND EXISTS (
 SELECT 1 FROM psychology_template_topics WHERE id=NEW.topic_id AND usage_count>0);
 SELECT RAISE(ABORT,'TOPIC_IMAGE_UNAVAILABLE') WHERE NEW.template='psychology-target-2' AND NOT EXISTS (
 SELECT 1 FROM psychology_topic_images i WHERE i.id=NEW.image_id AND i.topic_id=NEW.topic_id AND i.enabled=1
 AND NOT EXISTS(SELECT 1 FROM psychology_topic_image_uses u WHERE u.fingerprint=i.fingerprint));
END;
CREATE TRIGGER psychology_topic_usage_count AFTER INSERT ON psychology_topic_usage BEGIN
 UPDATE psychology_template_topics SET usage_count=usage_count+1,last_used_at=NEW.created_at WHERE id=NEW.topic_id;
 INSERT INTO psychology_topic_image_uses SELECT fingerprint,id,NEW.item_id,NEW.created_at FROM psychology_topic_images WHERE id=NEW.image_id;
END;
