# TikTok One non-advertising video detail — 2026-10-10

## Goal
Read and display the available non-advertising One data in both Factory psychology reports.

## Decisions
- Keep the 20-row official video list and add a real detail page using the same report path with oneVideo. Returning preserves the project, date filters, view and page. No modal, publishing changes or new synchronization jobs.
- A scoped GET videoId parameter returns one video's detail after current module/group/project and exact video ownership checks. Cached upstream records never bypass those checks. Unauthorized or filtered-out detail returns 404 without data.
- Shared explicit field allowlist includes overall/natural metrics, seven audience distributions, seven traffic sources, retention, daily metrics, media references and unique anchor metrics. Omit advertising and paid-flow fields from Factory responses and UI. Keep the existing Hub contract unchanged.
- The list carries availability flags/counts; full daily/retention/media detail is returned only for the requested video. No downloading or persistent duplication of video/image assets.
- Preserve zero versus null and break charts at missing points. Do not combine audience proportions, reach or watch averages across videos. Age and language codes stay as provider codes until a mapping is verified. Daily dates and publication timestamps keep the existing explicit provider basis.
- Official response coverage differs by video. Missing sections show no data instead of fabricated zeros. Website conversions and review status are not inferred from anchor clicks.

## Files changed
- public/psychology-one-analysis-schema.js and psychology-one-analysis.js.
- public/psychology-one-report.js/.css.
- factory-cloud/src/psychology-one-official-report.js, psychology-one-report.js and focused tests.
- scripts/psychology-one-report-ui.test.mjs; generated UI manifest and project architecture/current-state notes.

## Tests performed
- 96 related Factory analytics/module/asset tests passed, including eight focused mocked backend tests covering non-ad field whitelist, null/zero retention, all distributions/daily fields, read-only behavior, dates/project/module authorization and cache revocation.
- Real Chromium desktop UI test passed on both pages: details, escaped upstream labels, daily selector, gap rendering, empty states, retry, list return with page preserved, original report and task-source isolation.
- Desktop detail and audience screenshots inspected at 1600 x 1050.

## Unfinished work
Remaining regression checks, guarded production deployment and authenticated live verification.

## Recommended next step
Open Data Overview or Operations Report → TikTok One → a video's Data Detail. Keep missing metrics visibly unavailable and review individual video audiences rather than averaging proportions.
