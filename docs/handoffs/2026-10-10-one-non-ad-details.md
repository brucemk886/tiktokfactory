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
Completed. Runtime commit 0b863305b247a23ab9c7362e9d347c40438a9717 was committed and pushed to main before guarded deployment from a clean exact origin/main checkout. Worker version: eb01337e-8c99-4dfa-8edc-b7ef0da0df8d.

Live verification confirmed the 20-row detail links and scoped coverage counts. A historical video displayed audience bars, 61 retention points, 30 daily rows and unique anchor counts. A recent video detail returned 24 overall/natural metric fields and 20 retention points with audience/daily marked unavailable. Both report surfaces worked; recursive response inspection found no advertising or paid-flow keys. All reads used existing authorization; no publication was triggered.

## Recommended next step
Open Data Overview or Operations Report → TikTok One → a video's Data Detail. Keep missing metrics visibly unavailable and review individual video audiences rather than averaging proportions.

## Retention interaction follow-up — 2026-10-10
- Goal: show exact retention on hover and second labels along the x-axis.
- The whole plot resolves the nearest sample using the SVG screen transform, with a vertical guide and point highlight. Tooltip shows seconds and two-decimal retention; missing values stay unavailable and zero stays 0.00%. Pointer leave/Escape hide it; arrow/Home/End keys support inspection.
- Twenty-point videos label every second; longer series use readable integer intervals and retain the final second. Every sample remains available to hover and the numeric table. Chart uses the available desktop width.
- Changed public/psychology-one-analysis.js, psychology-one-report.css, the browser regression and asset manifest. No API/data/publishing changes.
- Real Chromium regression passed on both report pages, including scaled pointer coordinates, right-edge sample, null/zero, keyboard, 20/61-point axes and tooltip dismissal. Inspected the desktop hover screenshot.
- Seven UI asset integration tests also passed. Released after clean main push at runtime e47d311b90eb213fd2dac6ff0601564a90c1ea59; worker a2ec81e6-9dbc-4347-b0ac-a3a69e73a132. Authenticated live read verified 0–19 second labels and an actual mouse hover displaying second 9 / 20.00% with visible guide. No unfinished work.
