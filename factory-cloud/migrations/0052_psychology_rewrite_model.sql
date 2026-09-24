ALTER TABLE psychology_copy_variants ADD COLUMN rewrite_model TEXT NOT NULL DEFAULT '';
ALTER TABLE psychology_creative_snapshots ADD COLUMN rewrite_model TEXT NOT NULL DEFAULT '';

-- Backfill only the exact IDs produced by the factory batch generator.
UPDATE psychology_copy_variants SET rewrite_model='claude-sonnet-5' WHERE external_id LIKE 'ai-claude-sonnet-5-%' AND length(external_id)=43 AND substr(external_id,20) NOT GLOB '*[^0-9a-f]*';
UPDATE psychology_copy_variants SET rewrite_model='claude-opus-4.7' WHERE external_id LIKE 'ai-claude-opus-4.7-%' AND length(external_id)=43 AND substr(external_id,20) NOT GLOB '*[^0-9a-f]*';
UPDATE psychology_copy_variants SET rewrite_model='claude-haiku-4.5' WHERE external_id LIKE 'ai-claude-haiku-4.5-%' AND length(external_id)=44 AND substr(external_id,21) NOT GLOB '*[^0-9a-f]*';
UPDATE psychology_copy_variants SET rewrite_model='deepseek-flash' WHERE external_id LIKE 'ai-deepseek-flash-%' AND length(external_id)=42 AND substr(external_id,19) NOT GLOB '*[^0-9a-f]*';

-- Preserve model provenance for historical published items whose version is still known.
UPDATE psychology_creative_snapshots SET rewrite_model=COALESCE((SELECT v.rewrite_model FROM psychology_publish_items i JOIN psychology_copy_variants v ON v.id=i.source_id WHERE i.id=psychology_creative_snapshots.item_id),'') WHERE variant_id<>'';
