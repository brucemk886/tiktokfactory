ALTER TABLE factory_novels ADD COLUMN working INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_factory_novels_working ON factory_novels (working);
