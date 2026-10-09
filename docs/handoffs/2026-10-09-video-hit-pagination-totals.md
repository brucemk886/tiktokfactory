# Video Hits pagination totals — 2026-10-09

## Goal
Show record count and total pages beside the bottom-right source-list pagination.

## Decisions
Reuse the existing API total and pageSize (20 records per source page). Display 共 N 条记录 and 第 X / Y 页; empty results show 共 0 页. Counts follow the current search/type/scope filters. If results shrink beyond the requested page, reload the last valid page. Mobile counts wrap above the navigation buttons.

## Files changed
public/psychology-video-hits.html/.js/.css, generated UI asset manifest, this handoff.

## Tests performed
A read-only local Chromium fixture verified 45 records / 3 pages, last-page navigation, updated counts, filtering, empty results and 1440/390/320px layouts. Desktop/mobile screenshots inspected in primary tmp/video-hit-pagination-captures. Asset checks passed 7/7; manifest and diff checks passed. No backend, publishing or generation changes.

## Unfinished work
Commit/push, guarded deployment and live asset verification pending.

## Recommended next step
Ship through the clean main release clone and verify deployed assets.
