# Independent psychology operations report

## Goal
Separate operations review from the existing data overview. First version covers trends, account analysis, and automation batch review.

## Decisions
- /psychology-ops-report now serves a dedicated page; /psychology-effects and other overview routes remain unchanged.
- GET /api/psychology-operations requires the existing psychology-ops-report permission and restricts accounts, records, item counts and video reads to the psychology project and assigned groups. No permission expansion or publishing action.
- Filters: 7 days, 30 days, custom 1–31 days, media type, account group. Compare against the immediately preceding equal-length interval in Shanghai time.
- Views are current cumulative views grouped by publication day, not daily view increments. Work younger than 24 hours counts toward volume but is excluded from playback median/average, high-rate and zero-rate calculations.
- Confirmed publish success excludes pending receipts. Unknown media types are kept only in All content.
- Account and batch tables paginate 10 rows. Account drilldown exposes in-period works, observation flags and existing video details.
- Batch funnel separates generated assets, submitted jobs, confirmed publication and failures using exact task/receipt associations. Photo plan completion alone is not rendered-content completion.
- Data coverage is explicit: latest 100 archived works per account. Record and item safety limits show partial-data notices. Templates and topic analysis remain outside this first version.

## Files changed
- public/psychology-operations.html, .css, .js
- scripts/psychology-operations.js, .test.js
- factory-cloud/src/psychology-operations.js
- factory-cloud/src/index.js, pages.js
- factory-cloud/package.json
- docs/CURRENT_STATE.md, docs/ARCHITECTURE.md

## Tests performed
- factory-cloud npm test: 407 passed.
- New tests cover Shanghai/current/previous windows, 24-hour maturity boundary, median and rate denominators, missing/unknown media, exact batch attribution, missing task IDs, separate photo planning/rendering, route separation, API read-only behavior and project/group access restrictions.
- Isolated Chrome fixture QA passed: charts, account/batch pagination, account video dialog, photo filtering, invalid custom dates and recovery, mobile visibility, no page errors.
- Reviewed trend and batch screenshots in tmp/operations-trend.png and tmp/operations-batches.png.
- git diff --check passed.

## Unfinished work
Implementation and tests complete. Commit, push, deploy and production read-only smoke check follow.

## Recommended next step
Review real data at /psychology-ops-report. Link each generated work to its template and topic before building the subsequent template/topic comparisons.
