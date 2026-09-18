# Normal-view video list

## Goal
Show normal-view videos below the high/low/anomaly tabs, ten per page, with original-video and analytics-detail links.

## Decisions
- Return the previously omitted midView bucket from shared report computation. Default bounds are views >= 200 and < 1000; use report thresholds.
- Add an always-visible normal-video section below the tab module. Reuse the video table and authorized detail links.
- Normal, high and low lists have independent ten-item pagination; fresh filter queries reset pages.
- Future snapshots contain midView details. Older snapshots with a nonzero midView count but no rows explicitly explain that details were not recorded.
- No publishing or permission changes.

## Files changed
- scripts/official-group-report.js and .test.js
- factory-cloud/src/official.js (empty-report bucket)
- public/official-group-report.html and .js
- scripts/official-report-detail.test.js
- docs/CURRENT_STATE.md

## Tests performed
- factory-cloud npm test: 397 passed.
- Isolated Chrome: 21 normal videos paginate 10/10/1, detail/open links exist; existing tabs, anomaly expansion, detail metrics/retention and return navigation still pass.
- git diff --check passed.

## Unfinished work
Implementation complete; commit/push/deploy and production smoke check follow this handoff.

## Recommended next step
Open psychology overview; the 403-play video now belongs in the normal-video list below the tabs.
