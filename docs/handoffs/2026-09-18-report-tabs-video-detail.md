# Report tabs and video details

## Goal
Remove duplicate anomaly sections, combine high-view videos, low-view videos and anomalous accounts into three tabs, and expose completion/retention details.

## Decisions
- Reuse the shared report across overview routes. One tab panel is visible; counts, keyboard navigation, pagination and filter/return state are preserved.
- Anomalous accounts remain accounts with at least one zero-view video in the selected period. Each account expands to its zero-view videos; the separate zero-view panel is removed.
- Video details use the existing official detail endpoint and retention chart, now with completion rate, average/total watch time, duration, reach and interaction metrics. Missing fields remain unavailable rather than being fabricated as zero; a failed detail request can fall back to archived values.
- No sidebar permissions are expanded. Detail and archive requests are checked against existing project and assigned-account-group scope.
- Return URLs are limited to same-origin report routes matching the active module.

## Files changed
- public/official-group-report.html, .js, .css
- public/official-video-detail.html, .js
- scripts/official-group-report.js
- factory-cloud/src/official.js
- scripts/official-report-detail.test.js, scripts/official-analytics-ui.test.js
- factory-cloud/package.json
- docs/CURRENT_STATE.md

## Tests performed
- factory-cloud npm test: 392 passed.
- Isolated Chrome QA with fixture-only APIs: tab switching, zero-view account expansion, detail metrics and retention dots, return filters/tab, narrow viewport, no page errors.
- Inspected desktop screenshot in tmp/report-tabs-desktop.png.
- No publishing APIs called.

## Unfinished work
Implementation and tests complete. Commit/push/deploy and a production smoke check follow this handoff.

## Recommended next step
Open psychology overview and select the low-view tab, then 视频详情. Availability of private metrics depends on the official source returning them.
