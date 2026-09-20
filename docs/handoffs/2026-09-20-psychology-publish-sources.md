# Psychology publish source trace — 2026-09-20

## Goal
Let operators open a dedicated page that maps each automatic-publish account post back to its peer-hit URL, and stop the recreation board pagination from showing a wait spinner on hover.

## Decisions
- `/psychology-publish-sources` is admin-only under 心理学, labeled 发布对标. Existing psychology-publish sessions receive it on the next load.
- GET `/api/psychology-auto-publish/sources` pages 20 rows from `psychology_publish_items` plus frozen `peerSource` / `topicSource` payloads, then attaches official `shareLink` via `autoTaskId`. Historical photo jobs created before account snapshots still resolve `@handle` from publish records and `official_accounts_latest`.
- Disabled buttons use `cursor: not-allowed` instead of `wait`, so first/last-page controls no longer look like they are loading.

## Files changed
- `public/app.css`, `public/psychology-production.css`
- `public/psychology-publish-sources.html/.js/.css`, `public/psychology-auto-publish.html`
- `factory-cloud/src/psychology-auto-publish.js`, `sidebar.js`, `pages.js`, `auth.js`
- `scripts/sidebar-modules.js`
- tests and this handoff

## Tests performed
Focused factory tests for auto-publish sources, production cursor CSS, sidebar redirect, and session module insertion.

## Unfinished work / next step
Ship via `factory-cloud` `npm run deploy`. Confirm the live 发布对标 table and that 爆款复刻 上一页/下一页 no longer show a wait cursor.
