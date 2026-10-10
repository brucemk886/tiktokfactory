# Independent website conversion: Beijing dates and default Today

## Goal
Explain missing Today conversion counts, unify site date filters, and make the default date selection visible.

## Evidence and decisions
- Read-only production checks on October 10 found all 21 project links. The previous UTC Today cohort returned 0 clicks/arrivals, while Beijing Today returned 3 clicks and 3 arrivals with 0 starts, finishes or payments. This is a query-window issue; no historical data repair is needed.
- All 21 accounts had valid archived profile-visit samples through October 8 UTC, with no later day available during inspection. Missing current-day profile visits stay unknown, not zero.
- Website click cohorts now reuse websiteWindow (Asia/Shanghai) just like test/order reporting. Start is inclusive and the following midnight is exclusive; cohort definitions and channel/account exclusions are unchanged.
- Official profile daily samples retain a separate UTC profileWindow and latest available day. They are never shifted, prorated, or substituted from an older day. Disable profile-to-click ratios when the two windows differ.
- Page requests Today by default. Give aria-pressed buttons a scoped blue/white style: the shared console reset previously overrode the selected date style. Display the site timezone near the filter, profile scope separately, and tracking initialization in Beijing time.
- Preserve the API default of 7d for consumers that omit period. No changes to publishing jobs, receivers, configuration, tracking writes or source records.

## Files changed
- factory-cloud/src/psychology-website-funnel.js and focused tests.
- public/psychology-website.html/js/css and generated asset manifest.
- scripts/psychology-website-ui.test.js; CURRENT_STATE, ARCHITECTURE and FACTORY_API.

## Tests performed
- 30 focused database/API tests passed, including real SQLite cohort queries, exact Beijing midnight boundaries, early-morning inclusion, relative ranges crossing New Year, separate UTC profile dates, unavailable data and scope enforcement.
- Four existing Chromium UI/permission tests passed. Checked default Today request, blue/white computed selection style, timezone/lag hints, account filtering, preserved values on failed reads, stale request cancellation and receiving configuration independence.
- Inspected the 1366px desktop overview screenshot. Existing compatibility coverage retained; no new mobile layout or acceptance requirements.
- 29 additional unified API, profile-traffic and asset-manifest tests passed (63 focused checks total).
- Ran the changed readWebsiteFunnel against production D1 using read-only adapters at 2026-10-10 01:54 UTC: Beijing Today correctly returned 3 clicks / 3 arrivals / 0 starts / 0 finishes / 0 payments, null profile visits, latest profile date October 8, across 21 links.
- Production diagnosis used SELECT-only D1 queries and aggregate output. No real short-link requests or publishing calls were made.

## Unfinished work
Release verification pending.

## Recommended next step
Refresh Independent website conversion and verify Today counts against Beijing dates. Profile visits remain unavailable until new UTC daily samples are synchronized.
