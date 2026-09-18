CREATE TABLE IF NOT EXISTS psychology_template_topics (
  id TEXT PRIMARY KEY,
  template TEXT NOT NULL CHECK(template IN ('psychology','psychology-collage','psychology-target-2')),
  title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 50 CHECK(priority BETWEEN 0 AND 100),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  fingerprint TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0, last_used_at INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS psychology_topics_content ON psychology_template_topics(template,fingerprint) WHERE deleted_at=0;
CREATE INDEX IF NOT EXISTS psychology_topics_selection ON psychology_template_topics(template,enabled,deleted_at,usage_count,created_at);
CREATE TABLE IF NOT EXISTS psychology_topic_imports (
  id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS psychology_topic_usage (
  topic_id TEXT NOT NULL, batch_id TEXT NOT NULL, item_id TEXT NOT NULL UNIQUE,
  template TEXT NOT NULL, revision INTEGER NOT NULL, only_unused INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, PRIMARY KEY(topic_id,batch_id)
);
CREATE TRIGGER IF NOT EXISTS psychology_topic_usage_validate BEFORE INSERT ON psychology_topic_usage BEGIN
  SELECT RAISE(ABORT,'TOPIC_CHANGED') WHERE NOT EXISTS (
    SELECT 1 FROM psychology_template_topics WHERE id=NEW.topic_id AND template=NEW.template
      AND revision=NEW.revision AND enabled=1 AND deleted_at=0
  );
  SELECT RAISE(ABORT,'TOPIC_ALREADY_USED') WHERE NEW.only_unused=1 AND EXISTS (
    SELECT 1 FROM psychology_template_topics WHERE id=NEW.topic_id AND usage_count>0
  );
END;
CREATE TRIGGER IF NOT EXISTS psychology_topic_usage_count AFTER INSERT ON psychology_topic_usage BEGIN
  UPDATE psychology_template_topics SET usage_count=usage_count+1,last_used_at=NEW.created_at WHERE id=NEW.topic_id;
END;
