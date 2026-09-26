# Factory shared overview latency

## Goal
Speed up factory.tiktokaitool.com/psychology-effects (the factory shared data overview, not the mid-platform dashboard or task-only operations report).

## Findings and decisions
- Production baseline: report API 13,665 ms, response headers at 13,426 ms. Server waits dominated; 132 KB decoded response.
- The complete report loaded cached video JSON before serial bridge receipt requests (80 account IDs per request). Keep existing all-assigned-account / latest-80-video scope and Beijing date windows.
- Add authorized analytics/publish views to the same endpoint. Analytics renders first; receipt totals load separately with bounded concurrency of three bridge reads. Default full response remains supported and runs receipt reads alongside archive reads.
- Date-filter the first 80 entries of valid D1 report projections before JSON transfer. Timestamp/version validation, scope and cold archive fallback remain unchanged. Historical snapshots no longer load unrelated video packs.
- Missing/in-flight receipts display a dash and status, not zero. Filters abort obsolete requests and ignore late responses. No persistent browser cache or shared authorization cache.
- Server-Timing exposes scope/archive/compute/publish spans; generated asset manifest updated.

## Files
factory-cloud/src/official.js, official-archive-store.js/test, ops-report-store.js, psychology-module.test.js, ui-asset-manifest.js; public/official-group-report.js/html; scripts/official-report-detail.test.js.

## Validation
835 factory tests passed. Added live-vs-windowed parity, date boundaries, first-80 scope, corrupt-cache fallback, no-archive receipt view, three-request concurrency, cross-group denial, no-grant empty scope, split/full parity, early UI rendering, unavailable status, and aborted/late-response checks. No real publish calls in tests.

## Release and follow-up
Implementation made in an isolated clean main checkout at work/effects-fast-release because the main workspace contains another task's uncommitted changes. Commit/push main and deploy through factory-cloud npm run deploy. Record actual post-deployment factory timings in the task result. Do not attribute the separate mid-platform optimization to this factory fix.

## Second pass
First production validation retained all metrics but analytics still took 7,479 ms; receipt view took 5,065 ms. The context path repeated serial D1 reads. Reuse the existing batched fresh report context (canonical assignments, compact account rows), pass its rows through the overview, and launch both browser views concurrently. Add cache/fallback timing spans and endpoint tests for one context batch plus assignment revocation. The baseline immediately before deployment for 2026-09-26 was 9,045 ms; 348 videos, 83,599 views, buckets 10/135/199/4, receipts 357 total / 348 success / 9 failed.
