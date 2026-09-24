# Rewrite model attribution

## Goal
Show the model behind copy-library rewrite versions and preserve it for later effect analysis.

## Decisions
- Added rewrite_model to variants and creative snapshots (0052). Exact historical factory batch IDs backfill known models; other records remain unknown. No inference from Grokbot or translation providers.
- Batch generation saves the actual selected model; single drafts retain the returned model until save, independent of subsequent model-picker changes.
- Optional imports accept rewriteModel. Duplicate IDs cannot overwrite known attribution; unknown rows may be enriched.
- Library totals include per-model counts; detail table and comparison title display model.
- Photo and video rewrite jobs freeze attribution in copySource/creative snapshots, surviving version deletion. Content-performance rows expose rewriteModel; a separate model comparison dashboard is not added in this change.

## Files
0052 migration; rewrite-model helper; creative/store/library/source/evolution/auto-publish/operations modules; content-performance mapper; copy-library and peer-hits UI; API docs; focused tests.

## Tests
Factory suite: 667 passed. Covers batch attribution, single-draft save, duplicate metadata, migration backfill, grouped counts, photo/video publication snapshots. External generation and publication use mocks.

## Next step
Commit/push main, guarded npm run deploy, and verify live model labels. Historic manual drafts without model evidence remain unknown.
