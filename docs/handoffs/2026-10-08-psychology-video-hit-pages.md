# Psychology video hits child pages — 2026-10-08

## Goal
Change 查看二创 from an inline workspace into a dedicated child list, ordered by version; 查看详情 opens original/recreated copy and per-frame image comparisons.

## Decisions
- Source list stays at /psychology-video-hits. Child list uses /psychology-video-hits/recreations?id=SOURCE_ID; detail uses /psychology-video-hits/detail?id=SOURCE_ID&version=N. All reuse the same private shell and owner-scoped API. Real links support direct opens, refresh and browser back.
- Child list shows every created version, 1–20 in numeric order, including disabled/incomplete versions. New-version dialog offers unused numbers. Twenty existing versions disable creation. Frames/jobs load only on a detail page.
- Detail compares title, publishing caption and full narration in separate original/recreated columns. Each numbered frame independently shows both image, text and duration. Missing images have a visible placeholder; pages retain matching frame-number ranges.
- Child routes require the existing administrator + psychology-video-hits grant; both retain the parent sidebar highlight. Invalid/missing source/version URLs show a recoverable message.
- Desktop keeps a compact table; mobile presents ordered rows as cards with visible navigation actions. Existing uploads, revision/request IDs, enable and explicit render continue through the same APIs.
- This UI change does not activate any persistent renderer or resume old planning. The prior renderer approval remains separate (see 2026-10-08-psychology-video-hits.md).

## Files changed
- public/psychology-video-hits.html/js/css and public/access.js.
- factory-cloud/src/pages.js, sidebar.js, psychology-video-hits.test.js and generated ui-asset-manifest.js.
- scripts/psychology-video-hits-ui.test.js; CURRENT_STATE, ARCHITECTURE and psychology-video-hits-api guide.

## Tests performed
- 35/35 focused tests: source/version/frame permissions and writes, private assets, shared sidebar/theme/asset contracts, and the actual Chrome navigation workflow.
- Real browser: create source → child list → new version → detail; upload distinct original/recreated PNGs and text; enable/render into the isolated local queue without real generation/publication; create versions20–2 in reverse order and verify1–20 display; refresh/list/back/select version20; match source/recreated frame21 on the next page; reject missing/out-of-range/nonexistent URLs.
- Desktop1440 and mobile390/320 screenshot/layout checks. Main and child-list actions remain within viewport without horizontal scroll; version dialog stays in bounds. Independent original/recreated copy/images are asserted. No external browser requests, narration or publishing API calls.
- QA screenshots are ignored under tmp/video-hits-qa; focused run log is D:/cursor/localfactory/tmp/video-hit-pages-tests.log.

## Unfinished work
No feature work remains. Production release verification follows after deployment.

## Recommended next step
Open a saved source via 查看二创, review its numbered versions, and open 查看详情 to compare copy/images. Dot continues to use the existing API write guide.
