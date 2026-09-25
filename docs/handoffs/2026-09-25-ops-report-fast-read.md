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
Code85d56fb committed/pushed main; clean-main npm run deploy applied0060 and deployed Worker43cbfb30-a8ce-4c75-8b0e-622f337aa3b6. Existing scoped archives were backfilled by the initial read:187 projected accounts,620178bytes total. First backfill request18.641s is a one-time migration cost, not the normal path.
Subsequent full default-today reads:4.813s and4.201s versus18.839s baseline (~74–78% lower). Handler3.049s/2.484s; scope515/386ms, queries2534/2098ms, videos0ms. No report R2 reads on the normal path. Publication counts and cumulative metrics remained360planned,348published,6failed/needs-review,6pending,348synced,110509views,9groups/3strategies. Single-group filter returned40planned/38published/16277views and one group row;5.347s with network variance.
Evidence:ignored work/report-fast-read-evidence.json; agent session closed. No required work remains. Residual2–3s handler query/transfer plus session/network overhead remains; do not claim instant loading. Further improvements, if requested, could scope/lazily fetch non-overview history or persist completed report snapshots with strict revision/permission keys.
