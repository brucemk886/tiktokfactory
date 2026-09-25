# Psychology report scale phase 1 — 2026-09-25

## Goal
Make the operations reporting data path support 10,000 accounts without silent 5k/10k/20k truncation, full browser payloads, or request-time R2 migration.

## Decisions / architecture
- Migration 0061: long-lived account/video metric facts, normalized pilot/batch membership, durable task facts, account/day/group/strategy rollups for scheduled and actual publication dates, and a resumable dirty queue. Existing scheduler selection, generating and publishing queues retain their behavior.
- Archive ingestion upserts normalized metrics transactionally. Old videos survive falling outside the upstream latest-100 response. Older observations cannot overwrite newer ones. Missing metrics remain null; zero is real data. Explicit account archive deletion purges metric facts.
- Lightweight source triggers enqueue affected task IDs only. Minute maintenance reconciles batches of 500 with opaque version tokens; updates and acknowledgements share one transaction. This prevents concurrent changes and delete/reinsert ABA from losing an update. Video/account ownership deduplicates metrics across repeated task receipts. Rollups subtract old contributions then add new ones; repeated ingestion and downward metric corrections remain accurate.
- Existing-source migration uses keyset cursors. Legacy R2 reads only run in background, verify archive versions, and retry without blocking the normal task drain. Read endpoints only SELECT. The UI states when migration or task synchronization is incomplete.
- Current canonical assignments and project/group permissions are checked in SQL on every request. No account directory cap or legacy-grant fallback. Pilot attribution uses persisted mapping and frozen strategy; tasks from inaccessible pilot groups remain hidden.
- SQL aggregates, frequency-based exact medians, and indexed account/time scans replace application-wide arrays. Explicit join order avoids SQLite choosing repeated period scans. Advanced comparisons share materialized CTEs. Page size is 10; account/source/group/task/comparison paging and filters run on the backend, and tabs load on demand.
- Account stages continue to use all observed account videos; reporting counts same-day metrics. The separate scheduler's maturity rules are unchanged. Current cumulative metrics are grouped by publication date, not daily metric growth.
- stopPending now counts UPDATE RETURNING rows rather than trigger-inclusive total changes. Cancellation guard conditions did not change.

## Files
0061 migration and reproducible generator; psychology-report-facts.js; psychology-report-query.js; archive ingestion and minute maintenance; operations API/UI; focused tests; benchmark-ops-report.mjs; docs.

## Validation
749 full suite tests pass, including original publication/cancellation protections. Added real SQLite tests for all panels, permissions revoked after caching, zero/missing metrics, exact odd/even weighted medians, duplicates, stale observations, concurrent reconciliation ABA, source cleanup, independently scheduled/actual dates, and repeatable background migration. No real publishing calls in tests.
Synthetic local SQLite benchmark: 10,000 accounts × 2 posts × 30 days = 600,000 task facts plus 600,000 video facts. All 600,000 records count; all 10,000 accounts are returned through backend pagination. Measured read-only panel timings and bytes are recorded under ignored work/report-scale-10000.json. These are local single-reader SQL/API timings, not production D1 concurrency or a publication-throughput certification.

## Limitations / next steps
First phase is reporting only. Upstream TikTok collection cadence/limits, automatic selection history, cloud rendering, and publishing throughput are not a validated 10k-account pipeline. No background TikTok resync was added. Reporting preserves future observed data but cannot reconstruct historical videos already lost upstream. Complex month-wide exact comparisons cost more than today's dashboard. Monitor report backlog, synchronization age, D1 rows/time/storage and contention before increasing real production account counts; use measured results to decide on a separate analytics database or further precomputation.

## Release verification
Shipped from clean origin/main through npm run deploy. Main implementation a2522e9; D1 compound-query correction 4699776; readable comparison labels 8552fd6. Final Worker version e3b2f890-99ac-4f79-b9b0-533f9cc2bfcd. Migration 0061 applied successfully; do not regenerate this deployed migration.

Production checks: all four backfill cursors (videos/tasks/pilots/legacy) finished with empty errors; dirty queue reached zero. Before/after today's baseline matches: 360 planned, 348 published, 6 failed, 6 pending, 348 metric samples and 114,560 views across 180 accounts / 9 groups / 3 strategies. Browser checks cover account page 2, source page 2, readable comparison groups and two-item drilldown, rules, execution tasks (360 total, 10/page), and fresh overview without migration banner. D1 rejected the original six-way UNION despite local SQLite accepting it; production now uses a dimension CROSS JOIN and content loads successfully.

Observed authenticated overview API request: before 4,909 ms / 760,266 decoded bytes; final 1,861 ms / 12,618 decoded bytes. These are individual browser observations, not latency guarantees. Tabs now request their own data. Full suite: 749 passed; final label change additionally passed all six SQL report integration tests.

Final local benchmark (same 10k accounts / 600k tasks + 600k videos): today 798/849/851 ms (20k tasks); 30-day overview 12,722 ms; accounts 2,626; content 11,041; rules 8,885; comparisons 1,169; tasks 375; groups 6,428. All expected records and pagination totals verified. Evidence is in ignored work/report-scale-final.log and browser capture. Month-wide exact analytics remain a measured optimization target; do not present this as a concurrent production load test.
