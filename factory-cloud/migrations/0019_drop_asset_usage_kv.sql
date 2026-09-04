-- Asset usage stays on each worker machine. Drop the leftover factory_kv
-- snapshots so the last-writer-wins dashboard cannot resurface.
DELETE FROM factory_kv WHERE key IN ('asset-usage', 'asset-usage-dashboard');
