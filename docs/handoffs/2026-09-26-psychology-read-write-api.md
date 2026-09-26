# Psychology external topic/copy read-write APIs — 2026-09-26

## Goal
Expose all psychology template-bank topics and copy-library originals through existing integration keys, supporting reads and explicit edits by ID.

## Decisions
- Topic key: GET all banks (paged), single topic, authenticated uploaded images, PATCH with numeric revision; existing POST unchanged. Topic updates preserve omitted fields/replies/image fields, usage and frozen job snapshots.
- Peer-hit key: new `/api/integrations/psychology/copy-library` GET originals and owned rewrites, PATCH original or rewrite. Existing peer-hit GET worklist/POST remain compatible.
- Copy revision is opaque hash of mutable stored state; compare-and-set and atomic D1 batch guard original/source/cache edits. Running extraction is not interrupted. Updating body preserves frozen existing tasks and invalidates stale caches.
- Rewrite ownership and pending review are enforced; text edits run existing quality checks and clear unsupplied old review score/translation. No delete, publish, generation or review-approval routes exposed.
- No schema migration or production-data edits required. Existing keys remain valid.
- UI shows 读写接口 with separate copyable read/edit instructions, alongside existing POST/rules.

## Files
Topic-bank route/shared updater, new psychology-copy-integration module/tests, peer integration dispatch, index dispatch, two page instruction panels/scripts, API docs, CURRENT_STATE, npm test list.

## Validation
Complete isolated factory test suite passes (792 tests after added concurrency/content-edit cases). Covers pagination, shared originals/banks, original/video/image edits, source synchronization, asset auth, owner/source isolation, invalid body/fields, stale edits, concurrent writer guard, pending-review bypass rejection and metadata clearing. No real model or publishing API called by tests.

## Release / concurrent work
Implemented in `work/psychology-read-write-api` branch to exclude unrelated TikTok One edits currently in shared main worktree. Initial API-only intermediate edits still exist in shared root; do not indiscriminately reset shared entrypoint or commit unrelated work. Compare to final committed release when reconciling root.

## Remaining
None in requested API scope. Production smoke checks will verify UI instructions and unauthenticated route rejection; authenticated read/write behavior is tested in local SQLite fixtures without exposing/rotating production keys.
