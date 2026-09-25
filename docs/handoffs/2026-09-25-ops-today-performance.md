# Goal
Speed up psychology operations and default the report to today with a today selector.

# Evidence and decisions
Before fix, logged-in browser initial 7d API: 22,865 ms, 175,436 transfer bytes. Existing report loaded every account video pack in blocking waves of eight, read full batch configs/copy/plans and computed folded creative details on every visit.
Default today uses Beijing midnight to next midnight; adjacent comparison is yesterday. Preserve explicit 7d/30d/custom links and 24-hour maturity rules. Selecting a preset queries immediately; custom dates still submit together.
Archive reads now use a bounded continuous pool, report concurrency24, other callers8. Interactive reports skip legacy pack repair writes but still read D1 fallback. History query overlaps other report reads. Project list fields from batch configs; only expanded details request full copy and missing legacy plan. details=1 retains identical authorization and returns content only. Abort old UI reads and reject stale detail results after filters change.

# Files
scripts/psychology-operations.js/tests, factory-cloud/src/psychology-operations.js, official-archive-store.js/tests, psychology-creative.test.js, public/psychology-operations.js/html, state/architecture docs.

# Tests
734 passing. Covers Beijing/UTC rollover, previous-day comparison, explicit custom range, lazy-detail scope, stale responses, bounded concurrency, no repair writes and retained D1 fallback. No live publishing tests.

# Remaining
Code bbed36a committed/pushed main; deployed from clean independent main checkout under work/ops-report-release using npm run deploy, preserving original untracked diagnostics. Retained the original ignored remotion-assets resource set. A transient Cloudflare cron update fetch failure was retried through the same deployment command; final deployment fully succeeded including all four crons, version26215ad6-c004-4763-969c-42da2fc9cfa8.
Production browser: default period=today, 2026-09-25 compared with 2026-09-24, visible report, 13,615ms /64,551 bytes. Same 7d query after fix14,511ms vs22,865ms before (single observed samples, not SLA). Returned10 groups, HTTP200, summary content=null as intended. Remaining cold-load time is still significant; no claim of instant loading. No active publication jobs were changed.

Expanded live comparison loaded successfully on demand (16,125ms); page displays copy/style coverage without blocking initial overview.
