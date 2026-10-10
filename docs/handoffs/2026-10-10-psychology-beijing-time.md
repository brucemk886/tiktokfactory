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
Production release and authenticated read-only verification follow this commit. Provider-only daily aggregates cannot be rebucketed without confirmed source timezone or finer-grained metrics; this limitation is visible in the UI.

## Recommended next step
Verify One Today against actual archived publication timestamps after release; separately verify partial/missing provider coverage without conflating it with timezone alignment. Read-only check autopilot and receiving report labels. Do not recreate existing publishing tasks.
