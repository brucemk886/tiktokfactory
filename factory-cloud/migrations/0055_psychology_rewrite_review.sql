ALTER TABLE psychology_copy_variants ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE psychology_copy_variants ADD COLUMN review_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_copy_variants ADD COLUMN raw_response TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_copy_variants ADD COLUMN reviewed_at INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER psychology_copy_review_insert BEFORE INSERT ON psychology_copy_variants WHEN NEW.review_status='pending' AND NEW.enabled<>0 BEGIN SELECT RAISE(ABORT,'Pending rewrite cannot be enabled'); END;
CREATE TRIGGER psychology_copy_review_update BEFORE UPDATE ON psychology_copy_variants WHEN NEW.review_status='pending' AND NEW.enabled<>0 BEGIN SELECT RAISE(ABORT,'Pending rewrite cannot be enabled'); END;
