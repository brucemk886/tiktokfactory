ALTER TABLE factory_novels ADD COLUMN book_id TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_factory_novels_book_id ON factory_novels (book_id);
