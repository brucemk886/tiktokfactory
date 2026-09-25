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
Pending deployment and live read-only verification.
