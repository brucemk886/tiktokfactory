-- Serializes fair-test allocations sharing one owner and version sample pool.
CREATE TABLE psychology_copy_test_allocations (
  owner TEXT NOT NULL,
  revision INTEGER NOT NULL,
  batch_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(owner,revision)
);
