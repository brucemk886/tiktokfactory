# Grokbot writes original copy and rewrites in one call

## Goal
Let grokbot process both historical and future photo peer hits itself: supply the original page text and five rewrite versions per post through the existing write-only peer-hit API, so the 100 photo accounts have usable copy without manual export/import.

## Decisions
- Supplied `videoData.pageTexts` (photo, 1–6 pages) or `transcript` (video) completes the copy-library row inside the import batch, including `auto_extract=0` historical rows that the dispatcher never picks up. `attempt` is bumped so a running extraction cannot overwrite it. Finished copy is never replaced by later text.
- New top-level `rewrites` per item (≤10 per item, ≤500 per request) are validated with the same rules as page imports and inserted as enabled owner-scoped variants under `copySourceKey(videoUrl)`, the key `librarySource` uses. One `json_each` insert covers every rewrite to stay under D1's per-invocation query limit.
- Omitted `externalId` is derived from the content fingerprint, so identical resends are duplicates. A reused explicit ID with different content is counted as a conflict and skipped without failing the batch; versions stay immutable.
- Shape errors (bad pages, too many rewrites) reject the whole batch as before. Non-English posts store no rewrites.
- Each saved item now returns `copy` (ready / extracting / failed / needs_text), an optional `copyNote`, and rewrite counts, so grokbot knows which links still need text.
- User chose: grokbot does rewriting for old and new data, 5 versions per original, enabled on import. No factory-side AI rewriting or historical backfill was added.

## Files changed
- factory-cloud/src/psychology-peer-hits-store.js (supplied-copy completion, rewrites, per-item report)
- factory-cloud/src/psychology-peer-hits.test.js, psychology-peer-production.test.js (fixture migrations, new tests)
- public/psychology-peer-hits.js (in-page API example is now a photo post with pageTexts and rewrites)
- docs/psychology-peer-hits-api.md, docs/psychology-photo-creative.md, docs/CURRENT_STATE.md

## Tests
Full factory suite 583/583. New coverage: historical row completed by supplied text and never overwritten afterwards; ready/extracting/invalid-text reporting; five rewrites enabled under the canonical source key with idempotent resends; explicit-ID conflict isolation; whole-batch rejection for invalid/oversized rewrites; non-English posts keep none.

## Unfinished / next
- Live state before this change: 32 completed photo originals, 162 historical photo rows awaiting grokbot text, 0 rewrite versions, last grokbot write 2026-09-18.
- Not done (user deferred): page default tab still video, table still shows video-only columns, no card preview for versions, no read-only endpoint for grokbot to list `needs_text` links.
- Recommended next step: point grokbot at the updated API doc, resend the 162 historical links with pageTexts + 5 rewrites, then confirm in 文案库 → 图文爆款 that copies show as ready with 5 versions each.
