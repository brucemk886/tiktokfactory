# Daily receiving traffic report

## Goal
Add a daily Operations Report tab for photo-caption receiving-account traffic, exposure, profile visits, homepage-link clicks, website arrivals and funnel.

## Decisions
- Add 承接引流 beside standard and TikTok One only on Operations. Default Today; yesterday, 7/30 days, custom <=90 days and receiver filter. Show five-stage funnel, daily rows, receiver/publisher aggregates and 20-row paginated post details.
- Use frozen actual task receiver identity, covering optional manual mentions, imported-photo automation and older conversion allocations. Current settings never reassign historical posts. Migration 0089 preserves lightweight identity/CTA independently of media/job cleanup; first assignment wins. No active tasks or publishing settings changed.
- Restrict both publisher and receiver to fresh canonical project/account grants and fresh Operations module permission. Account aggregates contain no customer identities. GET performs no repairs, media loading or writes.
- Count confirmed published photos only and deduplicate exact account/video receipts. Exposure is latest cumulative plays of posts published in the selected Beijing period, with synchronized count; it is not daily incremental exposure.
- Sum each receiver's profile/website metrics once, across all publishers. Whole UTC profile daily samples remain separately labeled, with missing days/latest day. Never compute exposure→profile or profile→click rates because attribution/time windows do not support them.
- Reuse website click-cohort SQL for Beijing daily short-link visits, arrivals and tests, with once-per-click stages and cross-day attribution to click date. Unsupported/missing tracking remains null. Site failures preserve known photo/profile results.

## Files changed
- factory-cloud/migrations/0089_psychology_receiving_report.sql.
- factory-cloud/src/psychology-receiving-report.js, index.js; daily extension in psychology-website-funnel.js.
- public/psychology-receiving-report.js/.css, psychology-one-report.js shared navigation, psychology-operations.html/.js guards.
- Focused database/desktop tests and fixtures, first-paint guard, test command, asset manifest.
- CURRENT_STATE, ARCHITECTURE and psychology-management-api documentation.

## Tests performed
- Initial 31 backend checks passed across receiving, shared website funnel, existing Operations and One reports.
- Desktop Chromium verified filters, stale response rejection, paginated details, empty/error recovery, report request isolation, selected date styling and 1440/1600px desktop width. Screenshots inspected under tmp/receiving-report-qa (ignored).
- Full declared regression: 1,522 tests passed, zero failed (four concurrent test files). An earlier run exposed the new stylesheet first-paint expectation and selected-date theme override; both fixed and reverified. A pre-existing video preview navigation timeout passed standalone and in the final full run. Shared website funnel/data, receiver, cleanup and asset regressions also passed (67 focused checks).
- git diff whitespace checks and tracked UI asset manifest verification passed. No live publishing API was called.

## Unfinished work
Production deployment and authenticated read-only verification pending.

## Recommended next step
After release, open Operations → 承接引流 and choose Today or Yesterday. Treat missing profile samples as delayed/unavailable; only linked website stages provide attributable conversion rates.
