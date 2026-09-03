-- received_at is queried on its own by the 24h receipt stats and the nightly
-- prune; the existing (applied_at, received_at) index cannot serve either.
CREATE INDEX IF NOT EXISTS idx_factory_publish_receipts_received ON factory_publish_receipts (received_at);
