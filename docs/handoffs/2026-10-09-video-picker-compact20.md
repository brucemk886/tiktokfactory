# Compact video picker and twenty records per page — 2026-10-09

## Goal
Reduce the size of the video selection page/cards and show twenty videos per page.

## Decisions
- Video Hits, generated video and local-upload video inventories all paginate at twenty, with a lookahead row and explicit pageSize. Normal automatic draw keeps its explicit internal candidate limit.
- Desktop cards use five columns, 168px previews, smaller spacing/copy and compact controls. Responsive columns preserve mobile usability. Truncated titles/file names retain hover text. Pagination shows the page size.
- Preserve selection across pages, select/clear current page, maximum twenty selected videos, saved caption edits, lazy covers with two concurrent decoders, full preview controls and existing publication confirmation. Photo picker pagination and fifteen-image album limit stay unchanged.

## Files changed
Video library and hit inventory services; video picker JS and publishing CSS; generated asset manifest; video library regression and Chromium fixture; current state and this handoff.

## Tests performed
71 focused library/hit/asset/publishing UI tests passed. New SQLite case exercises 21 records in each of three sources: 20+1+0 pages, lookahead, unique records and no publication calls. Chromium desktop/mobile flow passed: twenty cards, five desktop columns, smaller preview height, cross-page edits/selections, full-page twenty selection, existing One/video and photo flows. All network publication calls mocked. Screenshots in primary tmp/video-picker20-ui were visually checked. Manifest/diff validation passed before commit.

## Release evidence
Runtime commit 8cb2ddcae59348c8ad3b4c0f5db4ea5826b18c2d was pushed to GitHub main before deploying from a clean exact HEAD == origin/main release with npm run deploy in factory-cloud. Cloudflare version 5191466e-7491-42fc-a198-f6e21b78bf03. Live video picker JS and publishing CSS hashes matched. Video inventory requires login (401), creation redirects to login (302). Existing transfer PID 100756 retained its original 2026-10-08 17:13:34 start time.

## Unfinished work
Implementation, validation and deployment complete.

## Recommended next step
Refresh the video selection page and inspect the compact twenty-item list.
