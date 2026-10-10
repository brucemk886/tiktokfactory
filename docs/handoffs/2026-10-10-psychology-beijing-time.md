# Psychology Beijing reporting and display time

## Goal
Use Beijing time throughout Psychology reporting and timestamp display, so Today and publication dates align across ordinary and TikTok One views.

## Decisions
- Use Asia/Shanghai for report calendars and actual timestamp display, independent of the operator computer timezone. Manual publication datetime-local controls both render and parse Beijing time; epoch values remain unchanged by display.
- Resolve One publication dates using permission-scoped exact account/video archive facts, then confirmed task receipts (explicitly labeled), then provider dates with an explicit timezone. Unzoned provider strings are not guessed. Unknown publication dates are counted and included only in All. Do not constrain upstream metric-report dates using local publication-date filters.
- Autopilot Today, seven-day traffic projections and historical observation display use Beijing days. Observation capture rows are rebucketed read-only by observed_at; no backfill or scheduler writes.
- Preserve existing execution timezone rules, frozen jobs and scheduled instants. Pacific recurrence configuration remains explicit; summaries show converted Beijing slots including the next calendar date and seasonal offset.
- Platform UTC whole-day profile counts cannot become Beijing midnight-to-midnight totals without hourly data. Show their real Beijing 08:00 to next-day 08:00 intervals across overview, autopilot, website and receiving reports. One detail daily aggregates have no confirmed source timezone and remain labeled as unconfirmed rather than fabricated Beijing daily values.
- Retain authorization boundaries, missing-value behavior and incoming receiving-report functionality.

## Files changed
- Shared public/report-time.js and psychology-publish-time.js.
- One official query and analysis/list presentation; autopilot dashboard and observation projection.
- Psychology publishing, task, content, conversion, website, receiving and report display scripts/templates; Psychology-scoped shared admin/analytics/records formatters.
- Focused report, boundary, timezone-independent input and desktop UI tests; tracked UI asset manifest; CURRENT_STATE.

## Tests performed
- 217 focused analytics, scheduling/display, pool observation, publish-input, shared report and website tests passed before integration.
- 69 post-integration receiving, One, website-funnel, shared assets, first-paint and desktop report checks passed.
- One desktop browser fixture verifies both report surfaces, authorization/empty/error states, paginated details and Beijing display while the browser timezone is America/Los_Angeles. Screenshots inspected at desktop size.
- Boundary checks include Beijing midnight, source-day month/year rollover and Pacific summer/winter conversions. No live publishing API was invoked.
- Tracked asset manifest generated; whitespace checks passed.

## Unfinished work
No implementation or release work remains. Provider-only daily aggregates cannot be rebucketed without confirmed source timezone or finer-grained metrics; this limitation is visible in the UI.

## Recommended next step
Verify One Today against actual archived publication timestamps after release; separately verify partial/missing provider coverage without conflating it with timezone alignment. Read-only check autopilot and receiving report labels. Do not recreate existing publishing tasks.

## Release verification
- Runtime commit 8d0e16042cf9e7c89a06dc52904cdfbf2ec76eb0 was pushed to GitHub main before release. Deployment ran from a clean main clone with exact HEAD == origin/main through factory-cloud/npm run deploy. No migrations were pending. Worker version: 3e4f4e3a-c651-4853-ae2c-8e58878c3663.
- Authenticated production reads at approximately 2026-10-10 10:49 Beijing returned 200. One Today contained 14 videos, all with exact video-fact publication times inside the Beijing day, including midnight and morning posts. Eight had play metrics; six remained missing rather than zero-filled. All dates contained 33 videos with two unconfirmed publication dates; pagination was not partial. These are an observation at verification time, not fixed expected counts.
- Autopilot returned Asia/Shanghai, Beijing midnight Today boundaries and seven dates October 4 through October 10. Its rendered range and profile source-day intervals matched. Receiving report loaded and rendered Beijing publication/click labels and explicit 08:00-to-next-08:00 profile windows.
- Six deployed JS assets returned 200 and SHA-256 matched normalized committed contents through the authenticated browser. Direct Python asset requests received 403; no credentials were exported. Page resource checks found no HTTP errors; recorded console errors came from a browser extension, not report code.
- Desktop layout acceptance used the local Chromium fixtures. The live Agent Window viewport was constrained by the host (resize rejected visible-screen bounds); live acceptance therefore used rendered DOM plus authenticated response evidence, not a production desktop screenshot. The owned browser session was stopped after verification. Debug evidence remains ignored/local.
- No live publish, retry, schedule recreation or settings mutation was performed.
