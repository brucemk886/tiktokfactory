# Template topic bank bulk deletion

## Goal
Add select-all and bulk deletion to each psychology template topic bank.

## Decisions
- Page checkbox, per-row checkbox, select current page, select all queried results (100 per read), clear and delete controls. Show exact selected count and confirmation with template name.
- All-results selection uses the last displayed query, not unsubmitted search input. Reload/filter/page/template changes clear selection. Bulk work locks bank interactions and reports progress.
- Reuse authenticated DELETE per ID with the selected revision. Soft deletion disables future draws; existing job snapshots and image assets are preserved. No new deletion permission or external API exposed. Conflicts remain undeleted; mixed success reports counts and errors. No production data deleted during development.
- This operation runs in the page; keep it open until completion. Individual writes have a 30-second timeout; an interrupted response can be ambiguous and should be checked after refresh.

## Files
public/psychology-topic-bank.html/js/css; public/psychology-topic-selection.js; scripts/psychology-topic-selection.test.js; factory-cloud/package.json; generated UI asset manifest.

## Tests
19 focused tests passed (including asset manifest checks): existing backend permissions/revisions, bounded selection with filters, partial failures, actual Chrome selection/confirmation cancel/pagination/last-page recovery/empty state/template isolation. Browser API fixture only, no publishing calls.

## Deployment
Committed and pushed 70bba7c to main; npm run deploy from a clean main checkout matching origin/main succeeded. Worker version 5f9737b6-6006-49c5-a61c-60660f90d0d9. Live health and both changed JS entry points returned 200 and new selection exports were verified. No remaining feature work.
