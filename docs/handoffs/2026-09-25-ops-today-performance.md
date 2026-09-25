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
Deploy committed/pushed main via npm run deploy from clean release checkout; verify today default, filter and timing on production. Preserve unrelated untracked diagnostic files in original checkout.
