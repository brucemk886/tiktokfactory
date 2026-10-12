# Video Hits material IDs and batch deletion

## Goal
Finish the user-requested material ID display and multi-select deletion, retaining the subsequently shipped single deletion and creation-time features.

## Decisions
- Display sourceId:vN as the material ID on ready cards, recreation rows and version details. Ready search accepts this exact ID. Media asset UUIDs remain separate from version identity.
- Ready selection supports select page, clear, individual checks, cross-page selection and at most 100 versions. Filters/explicit refresh clear the selection. Recreation lists support selecting eligible visible versions. Existing single/source deletion controls remain.
- Confirmation lists every title and ID, supports cancel and keeps one actor/request UUID for identical retries after uncertain responses.
- Session-only batch POST reuses the current cleanup handler and all its publication, digest, render and imported-automation blockers. Preflight identifies conflicts; a bounded twelve-statement transaction rechecks revisions, saved user grants/role and occupancy and verifies affected counts. One invalid item rolls back all changes and the receipt.
- Remove selected recreations only, retain original material and other versions, release only private files with no other reference/job. Preserve existing hard-delete/source reimport semantics and once-only published identities. No new schema, planner activation, real render or publication.

## Files changed
- factory-cloud/src/psychology-video-hit-cleanup.js, psychology-video-hit-ready.js.
- public/psychology-video-hit-delete.js, ready controller, shared page/controller/styles.
- Focused batch backend and desktop interaction tests, package registration, generated asset manifest.
- CURRENT_STATE, ARCHITECTURE and canonical/generated video-hit guide.

## Tests performed
- Existing cleanup/source/admin/photo/API/readiness regressions exercised; batch tests cover saved grants, cross-owner scope, stale revisions, replay, occupancy and authorization races, shared originals/files, deleted publication refs and 100 items in one bounded transaction.
- New 1600px Chromium test passed cross-page selection, cancellation, matching IDs/titles, unsafe text, entire-batch rejection, lost-response retry, count/filter refresh, version-list selection and existing detail deletion. Desktop screenshot inspected.
- Final batch/desktop/gallery/source/detail/import regression: all 22 passed. Existing backend regression had 114 passing checks; one removed-version expectation was corrected to the current 404 contract and passed in the final batch suite. Shared first-paint/asset checks: all 10 passed.
- No live publication or live deletion is used for validation.

## Unfinished work
None. Final regression and production read-only verification completed.

## Recommended next step
After release, refresh Video Hits, select poor materials and inspect the confirmation list. A blocked batch should be refreshed before reselection; existing queued/published materials stay protected.

## Release verification
- Runtime commit e1b0078 was pushed to GitHub main before the clean main release checkout ran factory-cloud/npm run deploy. Exact HEAD == origin/main passed; no migrations pending. Worker version b628e239-635f-4a28-8863-e1154d28c871.
- Authenticated production ready inventory returned 200, twelve current-page rows and 492 eligible versions at verification time. Every returned material ID matched its exact source/version; creation timestamps remained present. Exact ID search returned one version. Both selection controls and the zero-selected state rendered.
- All four changed JS/CSS modules returned 200 and normalized SHA-256 matched committed sources. A deliberately empty selection returned 400 before any mutation. No real deletion, generation or publication was performed during verification.
- Desktop layout and interactions were accepted in local 1600px Chromium fixtures. The live Agent Window remained constrained by host screen geometry; production acceptance used rendered DOM and authenticated read responses. Owned browser session stopped, evidence retained only in ignored local files.
