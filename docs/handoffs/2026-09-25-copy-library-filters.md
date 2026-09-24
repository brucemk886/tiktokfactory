# Copy library pagination and rewrite filters

## Goal
Investigate next-page complaints; make failed rewrites and quality rejects easy to locate.

## Findings and decisions
- Live read-only reproduction: photo library had 214 originals / 11 pages; page 1 -> 2 worked. Disabled navigation during loading was visually ambiguous. No permanent paging failure reproduced.
- Original extraction status and rewrite status are separate filters. Rewrite filters match canonical source keys, current owner and non-deleted variants before SQL count/pagination. Lightweight id/URL matching uses the same parser as imports (share links included).
- Attention combines pending quality review and latest failed batch generation. Pending counts open the detail dialog filtered to pending. Details also filter enabled, disabled and manually approved versions.
- Migration 0056 retains latest completed batch request result per owner/source, including bounded failure reason and model. A newer-started completed request wins over an older completion. Success clears the previous request failure even when resulting variants require review. This is not a background job queue; ongoing requests and old unsaved failures cannot be reconstructed. Single draft generation is unchanged.
- Main list only changes confirmed page after successful response; loading is explicit and bounded by 30 seconds. Detail pagination is clamped by the server, with guarded navigation/loading timeout.
- Source deletion removes associated attempt records. No generation or publishing calls are made by tests/live verification.

## Files changed
Migration 0056; psychology-copy-library and psychology-creative routes; library HTML/JS and peer list JS; focused backend/UI tests; CURRENT_STATE.

## Validation
Full factory suite: 688 tests passed, including owner-scoped status counts, filtered second pages, page clamping, provider failure recovery, pending shortcuts and navigation retry. Read-only live checks required after deploy. Browser debug capture unavailable because installed BSK daemon does not implement debug RPC; DOM captures used instead.

## Next step
Commit/push main and deploy through npm run deploy from a clean main checkout, then verify filters/pagination in live UI. Existing browser generation should finish before the user refreshes.
