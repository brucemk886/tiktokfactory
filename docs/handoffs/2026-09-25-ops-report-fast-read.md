# Goal
Fix persistent slow loading on the psychology operations report.

# Measured bottleneck
Added Server-Timing (diagnostic code c8ae7ac, productionb447e36d-162c-40c8-8c8f-286fac1336c3). Same logged-in default-today request18.839s:TTFB18.720s,download0.119s,~79.8KB transferred. Handler17.282s:group loading1097ms,directory1622ms,parallel history3748ms/receipts3907ms/items3952ms/pilots4029ms,archive videos14202ms,framework361ms. Main bottleneck is raw per-account R2 fan-out plus repeated database round trips, not browser rendering or TikTok live polling.

# Change
Migration0060 adds per-account report metric projections. Ingest persists normalized compact metrics and account timestamp together; deletes remove both. Reads check timestamp/version and keep authorization fresh. Legacy first read fills matching projections once; stale pack/concurrent timestamp checks prevent stale writes. This caches derived source data, not rendered user responses, so current publication states and group permissions remain current on each visit.
loadReportContext performs one lightweight three-query batch; inputs use a second batch. Resolved-item mapping reused by scheduler; topic data supplied to framework to avoid an extra query. Legacy archive consumers unchanged.

# Files
0060 migration; official-report-videos.js; official-archive-store.js/tests; psychology-report-data.js; psychology-operations.js/tests; resolved-item query refactor in psychology-copy-evolution.js; docs.

# Validation
743 full-suite tests pass. New coverage: hot path two batch reads/no R2, ingest refresh and deletion, null/zero and retained retention/favorite metrics, once-only backfill, stale update race, empty canonical assignments and revoked group permissions. No real publishing calls or active-job changes.

# Release / remaining
Pending deployment, initial projection backfill and live before/after timing with matching counts.
