# Copy library usage and effects — 2026-09-26

## Goal
Add a content-only view of copy inventory, draw coverage and original/rewrite performance. Exclude extraction pipeline counters, accounts/groups, scheduling, publishing statuses, remaining per-account stock and operational controls.

## Decisions and implementation
- Library header links to `/psychology-copy-usage`, a child page using the existing copy-library/source-management admin grant. No additional publishing/report grant is required.
- Read-only `GET /api/psychology-copy-library/usage` supports media, title/topic search, Beijing all/today/yesterday/7d/30d/custom dates, usage/effect filters, metric sorting and 20-row SQL pagination.
- Current inventory covers completed usable originals and current owner's non-deleted rewrites (usable/pending/disabled). Search/media scope inventory; dates apply only to draws and observed effects. Original content catalog remains shared, consistent with the existing library.
- A separate content read adapter resolves immutable selection records into source/version/draw-time observations. It reads existing local deduplicated ops_task_facts for effects. It exposes no account/group/batch IDs, statuses or controls and invokes no publishing, scheduling, TikTok, R2 or repair services. No migration or write-path changes.
- Lightweight original identity columns are canonicalized with the exact existing photoCopyKey function; SQL receives an identity map and does all historical aggregation and pagination. Legacy original source IDs, rewrite source IDs, snapshot external IDs and internal rewrite IDs are resolved. There is no fixed historical row truncation.
- Draw count = distinct existing selection item, at its batch's creation timestamp (actual selection time). Retries of the same item do not multiply draws; later cancellation/deletion does not undo the historical draw. Coverage includes using any rewrite of an original.
- Effects use actual content publication dates and the latest locally synced cumulative metrics, not daily increments. Same-day observations count immediately. Missing views are excluded, real zero included. Exact weighted median and >=1000 / >=10000 rates aggregate individual samples. Completion averages non-null values, including zero, with its own sample count.
- Main list compares original/rewrite medians and sample sizes. Version dialog is independently paginated; text loads only on request. Deleted rewrites with historical observations remain visible as history and do not inflate inventory. Deleted original sources are outside the current library scope.
- UI cancels/ignores stale requests, distinguishes no data from zero, recovers pagination on failed reads and uses textContent for user content.

## Files
- factory-cloud/src/psychology-copy-usage.js and tests: content read adapter and statistical regressions.
- public/psychology-copy-usage.* and scripts/psychology-copy-usage-ui.test.js: dedicated review page, filters, cards, comparison, detail and race/failure tests.
- Existing library, pages, sidebar/access aliases and package test list wired to the new child page.

## Validation
- Full factory-cloud suite: 764 tests pass. Focused checks cover dates, null/zero, ownership, legacy attribution, deleted versions, permissions, API/body isolation, pagination and >20,000 historical samples.
- Synthetic local SQLite benchmark: 600,000 selections and matching observations, 8 sources, complete totals and exact median 2499.5, ~1.27 seconds for the statistics request. This is a local synthetic measurement, not a production/10k-account capacity guarantee.
- UI tests cover late responses, aborts, failed-page recovery, lazy detail/body, close races and text-safe titles. No real publishing API calls.

## Release / remaining work
Code release and authenticated production verification follow this commit. Verify library entry, date/media changes and version text in the live browser. Current library identity mapping scales with number of originals, not account/task history; consider persisting canonical identity keys if the content catalog itself becomes very large. Existing analytics sync coverage remains the source of effect completeness.
