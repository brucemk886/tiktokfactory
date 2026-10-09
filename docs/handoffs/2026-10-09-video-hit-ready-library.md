# Video Hits ready-to-publish gallery

## Goal
Show prepared photo/video recreations immediately on the Video Hits homepage, excluding already-published items, so an operator can preview and create a task using that exact material.

## Decisions
- Default homepage is a ready-version gallery; explicit ?view=sources retains source management. Legacy type/import-source query links still select the source table. Child source/version routes and imports stay intact.
- Read-only readiness SQL applies current creator/admin permissions, filters and completeness before counts/pagination. Exclude disabled, archived, cleaned, reserved, published (even without TikTok IDs), historical source-version usage and imported file-digest usage. Only 1–15 ordered complete photo frames or current cloud-ready video previews qualify. A dual-format version appears once in All and counts in each available format.
- Gallery includes photo/video preview, ordered per-frame text, stored caption, importer/creator labels, search and type/import filters. A same-module private media endpoint supports range requests without requiring publication rights; publish actions are shown only with the publication grant.
- Creation links carry exact source/version/revision/media type. Destination validates readiness again and blocks submission if stale. Existing photo and One pickers preselect the version. Normal video creation gains optional explicit videoVersions; existing random draw works unchanged if omitted. Existing final account/One/CAS/file/version reservation checks remain.
- Importing remains disabled by default. No enable, render, queue or publication side effects occur on gallery reads. No migration, background planner activation or worker restart.

## Files changed
- New factory-cloud/src/psychology-video-hit-ready.js and focused tests; index handler registration.
- Publication normalization and normal explicit selection; published-state exclusion in video/photo resolvers and inventory.
- New public/psychology-video-hit-ready.js; Video Hits shell/styles/controller.
- Existing photo/video pickers, automatic creation shell/controller and generated UI manifest.
- New gallery browser test; existing source/import browser regressions; package test registration. Browser teardown explicitly closes test HTTP connections to avoid keep-alive stalls.
- Canonical/generated API guide, CURRENT_STATE and ARCHITECTURE.

## Tests performed
- Initial publishing/permissions/API/UI regression: 92 passed.
- New readiness/selection/media scope tests: 5 passed, covering filtering before pagination, missing TikTok IDs, duplicate file exclusion, fresh permission/revision checks, exact selected normal video publication, durable replay and current/stale composed previews.
- New Chromium end-to-end test passed: homepage, ordered image preview/copy, type/import filtering, exact photo and normal-video submission bodies, One preselection and stale-selection blocking. Screenshots inspected at 1440 and 390; overflow checks also cover 320.
- Before main integration, the full declared suite passed 1,454 tests. Integrated source/gallery/member browser regressions passed all three tests. Final full declared suite, including concurrent imported-photo and website changes: 1,473 passed, zero failures (test concurrency 4). No real publishing API called; all publication tests use fixtures.

## Unfinished work
None for this delivery. No production publication was initiated for verification.

## Recommended next step
Refresh Video Hits. Preview an enabled ready version, then choose its photo/video task action. Keep using Source Management for disabled drafts or incomplete content.

## Release evidence
Runtime commit 911e7d85551d8e705cfbfce46d2393cea7d3191d was pushed to GitHub main before npm run deploy from a clean worktree with HEAD == origin/main. Worker version 86381206-607c-4513-b0e2-06f26f4ca231 deployed successfully. Live gallery/source/publisher JavaScript, gallery CSS and API guide returned HTTP 200 and matched local SHA-256. Private pages redirect to login and the ready API returns 401 without a session. The exact readiness SQL ran read-only against production (zero rows written), returning 154 eligible versions: 65 photos and 89 videos at verification time. No migration, live material edit or publication was performed.
