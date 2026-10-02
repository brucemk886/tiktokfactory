# Psychology Operations Report playback metrics — 2026-10-02

## Goal
Add playback as the core Operations Report metric, including overview, account and content performance.

## Decisions
- Promote exact cumulative views to the first highlighted KPI, with previous-period total and absolute/relative change. A zero prior baseline has no fabricated percentage.
- Default the existing actual-publication-cohort trend to cumulative views and add total-view columns to daily, account, source and comparison tables.
- Preserve Beijing actual-publication windows and separate photo/video selection. These are current lifetime views of the selected publication cohort, not newly acquired traffic within the date range.
- Reuse SQL weighted-view aggregation and expose the same field through the memory framework. Totals are computed before pagination under the existing authorization; no frontend multiplication or page-row sum.
- Account/content pool metrics show mature-sample totals. Content also shows all synchronized observations, so fresh versions have visible playback while mature evidence remains unavailable.
- Preserve zero versus null, existing mature qualifications, permissions, scheduling and active publication jobs. No database migration or provider operation.

## Files changed
- factory-cloud/src/psychology-report-query.js and focused tests.
- scripts/psychology-ops-framework.js and focused tests.
- public/psychology-operations.html/.css/.js and scripts/psychology-operations.test.js.
- Generated UI asset manifest, CURRENT_STATE and this handoff.

## Tests performed
- Factory-cloud regression: 1,190 passed, zero failed/cancelled/skipped.
- SQL/framework checks: exact full-scope totals across pages, actual versus scheduled dates, photo/video distinction, prior/current/daily sums, missing and zero, deduplicated receipts, latest metric correction, stale updates, permissions and no GET writes/network.
- Operations frontend checks: 30 passed, including primary total and prior comparison, zero-baseline handling, default playback trend, missing gaps/real zero, mature versus all-synchronized content totals and existing lazy-panel behavior.
- Independent review passed. Browser verification passed at 1440, 1401, 1400, 1366, 1301, 1280, 1200, 1024, 960, 390 and 320px, including 1,234,567,890 views and 100.0%; no card/page overflow or runtime errors. Tables scroll within their containers. Fixture QA made zero external requests.

## Unfinished work
Commit/push main, standard production deployment and authenticated read-only verification remain.

## Recommended next step
Ship from a clean exact-origin/main checkout, verify the live totals and scoped account/content columns, then record release evidence here.
