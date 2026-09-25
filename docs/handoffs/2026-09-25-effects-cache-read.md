# Data overview slow-open fix — 2026-09-25

## Goal / cause
The psychology 数据概览 (/psychology-effects) used the shared /api/official-tiktok/ops-report handler, distinct from the newly scaled operations report. Its loadArchiveBundle reread one R2 video pack per account with the legacy pool on every visit, and also loaded archive account metadata twice. Production reproduction completed after 53,629 ms; navigation itself was working.

## Changes
- ops-report-store.js now reuses the synchronized D1 report projection through the existing timestamp/version checked loader. Warm reads perform no R2 reads; legacy misses retain bounded fallback/backfill behavior.
- official.js reuses freshly scoped account metadata instead of fetching it twice.
- Kept this shared overview's existing latest-80 videos/account and current report/permission semantics. This targeted repair does not make the shared overview a fully SQL-paginated 10k-account report. Publish outcome stats still come from the existing bridge API.

## Validation / deployment
750 full tests passed. Added a real SQLite regression proving no warm R2 reads, account scope isolation, unchanged computed summary/buckets versus raw packs, and newly synchronized metric visibility.
Committed/pushed main 73bbbb3 before npm run deploy. First deployment attempt stopped during D1 validation on transient Cloudflare 7403; retry succeeded without changing credentials or bypassing checks. Worker dce7b923-2bbb-4b37-abdb-758a2ed12b39.
Authenticated production observation: API 53,629 ms before, 8,407 ms after. Identical summary: 350 works, 124,448 views, 9 zero / 128 low / 201 normal / 12 high; 180 accounts. Publish outcomes unchanged: 353 total, 348 success, 5 failed. Individual timings are not an SLA. No publishing jobs were stopped or submitted.

## Remaining / next step
Shared overview still builds complete bucket arrays and awaits bridge publish statistics. For the broader 10k-account expansion, move this separate page to scoped SQL aggregation and backend paging too, with durable publish-stat projections. Do not silently replace its all-account-content scope with the automatic-task-only operations report.
