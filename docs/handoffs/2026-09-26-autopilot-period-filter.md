# Autopilot period filters — 2026-09-26

## Goal
Add Today (default), Yesterday and Last 7 Days to psychology automatic operations.

## Decisions / files
- public/psychology-autopilot.html/js: Beijing-date selector; execution cards, comparison, slot headings and logs follow selected period. Status refresh, 30s polling and group refresh retain selection. A selection changed during an in-flight refresh discards its result and immediately reloads the latest selection.
- factory-cloud/src/psychology-autopilot.js: validate period and return explicit calendar boundaries; SQL scopes slots and logs by the selected range. Seven days includes today and six preceding dates. Removed the 12-slot cap within that bounded window. Exact batch membership and owner restrictions preserved. execution contains range counts; today remains its compatibility field. Account controls/current status and latest matured 7-day strategy analysis remain current and labeled separately. Log view retains its stated latest-60-per-pilot bound.
- Updated backend and UI tests. No scheduler, generation, publication or pause/cancellation behavior changed.

## Validation
754 suite tests pass, including Beijing midnight boundaries, all 14 slots in a two-post seven-day fixture, outside-range exclusion, owner/overlapping-slot isolation, retained selection across polling and fast-switch stale-response protection. Tests make no real publishing calls.

## Release
Committed/pushed ebaea19 to main, then deployed via npm run deploy from clean HEAD==origin/main. Worker 74c439cc-51a4-49cf-853b-b43063702adf. Logged-in browser verified today=360 planned, yesterday=360 planned / 348 published / 6 pending / 6 failed / 18 slots; last 7 days (2026-09-20 through 2026-09-26)=720 planned / 36 slots. Only GET and UI filter operations used; active generation continued normally.
