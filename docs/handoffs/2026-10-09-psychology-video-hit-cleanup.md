# Psychology video-hit cleanup — 2026-10-09

## Goal
Prevent accumulation of published recreations across image composition and ready-video input without deleting shared/draft/active work or permitting repeat publication.

## Decisions
Confirm real official publication before starting a 24h grace; move immediately to published records. Bounded five-minute R2 collection uses reference/CAS fencing, exact ownership prefixes and durable deleting/deleted receipts, with failed deletion retries. Keep lightweight source/version/publish/digest identities. Originals require explicit all-published source closure plus24h; drafts and unknown/failed versions persist. Orphan/provisional uploads receive24h; recent failed frozen job refs hold7days. Remove per-render temporary trees immediately and assign published local MP4 deletion to original worker with verified manifest/containment checks. Local worker changes take effect only when supported code runs; no current process or old planning is restarted. External-host URLs and Hub/TikTok files are outside Factory GC.

## Files changed
Migration0082; video-hit cleanup API/collector and shared queue worker routes; immutable provisional image/video uploads and active asset pinning; video-library preview fencing; recreation list/status/archive UI; main/remix worker cleanup runner; renderer temporary cleanup; API catalog/guide; focused backend/filesystem/browser tests; CURRENT_STATE/ARCHITECTURE.

## Tests performed
Final npm test passed1336/1336 with no skips. Focused cases cover confirmation/grace, shared/draft/active/recent-failed holds, failed deletion retries, CAS races, distinct deletion receipts, provisional uploads, cross-library collisions, local worker targeting/authentication/acknowledgment/retry, Windows junction/path rejection and compacted heavy snapshots. Real Chromium exercised upload/playback/publication UI plus pending/published filters,24h collection, retained links, source closure and cleanup status. Desktop1440/mobile390/320 screenshots were visually inspected; all status counters and actions are visible. UI manifest and git diff checks passed. All publishing and storage endpoints are synthetic test fixtures; no live publishing calls.

## Unfinished work
Production deployment confirmation pending; record runtime commit/version and read-only checks here. Dedicated remix helper remains unstarted pending explicit activation from the previous background-process approval review.

## Recommended next step
Dot should query videoHits.jobs for official publication and videoHits.cleanup for retention/backlogs; use videoHits.archive only when no further recreations are needed. Read-only live deployment checks; never run synthetic production publishing tests or restore historical planning.
