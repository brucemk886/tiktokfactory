# Psychology data overview

## Goal
Use the novel promotion data overview contents for the psychology overview.

## Decisions
- Route /psychology-effects to the shared official-group-report page, keeping the existing sidebar URL and permission ID.
- Bind this route to the psychology module even if a conflicting module query parameter is supplied.
- Use 数据概览 as its title; preserve the separate /psychology-ops-report title and other business modules.
- Reuse existing date/group filters, project report toggle, 11 metric cards, anomalies, and video buckets without changing report data or enabling statistics automatically.

## Files changed
- factory-cloud/src/pages.js
- public/official-group-report.js
- public/official-group-report.html (script cache version)
- factory-cloud/src/psychology-module.test.js (these new regression tests were included in concurrent commit a458c83 before the page changes were restored)
- docs/CURRENT_STATE.md

## Tests performed
- node --test factory-cloud/src/psychology-module.test.js scripts/official-group-report.test.js: 27 passed.
- factory-cloud npm test: 373 passed.
- Tests cover route and permission preservation, actual shared-script rendering of 11 metrics, project scope despite conflicting query, and date/group filter requests. No publishing APIs are called.

## Unfinished work
None in implementation. Commit, push and production deployment follow this handoff; verify the live psychology overview after deployment.

## Recommended next step
Open /psychology-effects and use the existing project statistics toggle/date/group filters as needed.
