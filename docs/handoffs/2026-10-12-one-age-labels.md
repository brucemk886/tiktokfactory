# One audience age labels

## Goal
Show concrete viewer age bands instead of opaque age group codes in both Psychology One video details.

## Decisions
- TikTok /open_api/v1.3/tto/tcm/report/ returns audience_age_distribution.age as numeric string enums, while the UI previously displayed the raw code.
- Verified primary official document 1815693573340162 through its public node response, code 0, version 1.3. Current slug: https://business-api.tiktok.com/portal/docs/report-on-tto-creator-marketplace-videos/v1.3. Codes 1–6 mean 13–17, 18–24, 25–34, 35–44, 45–54 and 55+.
- Decode known codes in the display only. Preserve raw labels/percentages in the API, bar order, authorization and all report metrics. Unknown numeric codes say unknown with their original code; readable labels stay unchanged.
- No provider calls, publication settings, jobs or database migration are introduced.

## Files changed
- public/psychology-one-analysis.js.
- scripts/psychology-one-age-label.test.js and existing One desktop acceptance test.
- factory-cloud/package.json and UI asset manifest; CURRENT_STATE.

## Tests performed
- 10 age-label, percentage-preservation and scoped One backend tests passed.
- Both PC One report/detail surfaces passed the existing desktop Chromium acceptance, including age label, missing data, unsafe labels, charts, filters, pagination and backward navigation.
- No live publication API was called.

## Unfinished work
None. Deployed and checked against a real authorized One video detail.

## Recommended next step
Refresh a One video detail and inspect its audience age bands; the former code 2 should show 18–24 years without changing its percentage.

## Release verification
- Runtime commit 6a44b03 was pushed to main before deployment from a clean main release checkout with exact HEAD == origin/main. npm run deploy completed; no migrations were pending. Worker version b4cdb674-d119-40f7-8374-201b414fc369.
- Authenticated production video details rendered all six concrete age bands and their returned percentages. A checked sample showed 18–24 at 53.72%; raw report values were not rewritten. Page resource checks found no HTTP errors.
- Primary official doc node returned code 0 with content_slug report-on-tto-creator-marketplace-videos and the explicit numeric-string age mapping. The browser session was stopped. Local ignored evidence contains no credentials and is not committed.
