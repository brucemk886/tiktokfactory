# Video Hits pagination totals — 2026-10-09

## Goal
Show record count and total pages beside the bottom-right source-list pagination.

## Decisions
Reuse the existing API total and pageSize (20 records per source page). Display 共 N 条记录 and 第 X / Y 页; empty results show 共 0 页. Counts follow the current search/type/scope filters. If results shrink beyond the requested page, reload the last valid page. Mobile counts wrap above the navigation buttons.

## Files changed
public/psychology-video-hits.html/.js/.css, generated UI asset manifest, this handoff.

## Tests performed
A read-only local Chromium fixture verified 45 records / 3 pages, last-page navigation, updated counts, filtering, empty results and 1440/390/320px layouts. Desktop/mobile screenshots inspected in primary tmp/video-hit-pagination-captures. Asset checks passed 7/7; manifest and diff checks passed. No backend, publishing or generation changes.

## Release evidence
Commit f483bfcc0be42c9cdaaa155ae72c0d8a2abf82ec was pushed to main before deploying from a clean exact HEAD == origin/main release with npm run deploy in factory-cloud. Cloudflare version 75365467-ebdd-42ac-b668-e69f58ad2af6. Live JS/CSS hashes matched after edge propagation; private route/API authorization checks passed. Existing transfer PID 100756 retained its original start time.

## Unfinished work
Implementation, verification and deployment complete.

## Recommended next step
Refresh the Video Hits source list and inspect the bottom-right record/page counts.
