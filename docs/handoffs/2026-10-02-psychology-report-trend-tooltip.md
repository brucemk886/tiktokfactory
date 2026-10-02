# Psychology report trend tooltip — 2026-10-02

## Goal
Show exact date/metric values immediately when the user hovers over the Operations Report trend.

## Decisions
- Replace the tiny-point native title with a visible HTML tooltip. The complete plot uses the nearest date, so users do not have to target the small SVG dot exactly.
- Reuse the existing selected publication-cohort daily data and formatting. Null stays unavailable, real zero stays zero, and missing days remain chart gaps.
- Show the date, selected metric label and formatted value. Escape source labels/dates; keep the tooltip within the chart at both edges and on narrow screens.
- Support circle keyboard focus, blur/Escape dismissal, mouse departure and touch/click. Metric changes and empty results replace tooltip state automatically.
- Keep style selectors scoped to Operations Report. No API, reporting scope, scheduling, generation or publishing changes.

## Files changed
- public/psychology-operations.js and public/psychology-operations.css.
- scripts/psychology-report-trend.test.js, registered in factory-cloud/package.json.
- Generated factory-cloud/src/ui-asset-manifest.js and this handoff.

## Tests performed
- Existing operations checks: 30 passed before the browser interaction tests.
- Real isolated Chrome exercises hover away from points, missing/zero, escaped dates, native Tab focus and Escape, formatted percentage/seconds, metric switching, touch, single-day/empty data and 1440/390/320px edge bounds. Zero external requests and runtime errors.
- Full factory regression: 1,191 passed, zero failed/cancelled/skipped using the registered npm-test file list with test-concurrency=1. The default parallel attempt encountered unrelated local browser-test timeouts and was stopped only for its owned test processes; sequential execution passed all checks. No production jobs were affected.

## Unfinished work
Commit/push main, standard deployment and authenticated live hover verification remain.

## Recommended next step
Release from clean main exactly matching origin/main and verify tooltip values against the existing daily table.
