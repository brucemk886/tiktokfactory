# Psychology failed-item deletion — 2026-09-19

## Goal
Add Delete beside Retry for failed automatic-publishing items; explain the historical photo upload failure.

## Decisions
- DELETE /api/psychology-auto-publish/:itemId requires the existing admin/module permission and batch ownership.
- Migration 0031 adds a deletion timestamp. Atomic guarded writes mark only idle, unstaged, unsubmitted failures as deleted and cancel their job. Historical receipts and successful siblings remain intact. Duplicate deletion is idempotent; deleted entries cannot be retried or resurrected by a delayed video handoff.
- Running jobs, staged assets, remote receipts, and groups with frozen requests are protected. Group submission excludes deleted members and rereads membership after acquiring its lease. Deletion never makes a publishing API call; if all remaining members are ready, the page offers Submit remaining content. All-deleted groups render as cancelled.
- The UI confirms deletion, refreshes the queue and shows deleted counts. The original task count remains available for reference.
- The historical 0918-测试-3 local render job failed at the /upload fetch in psychology-auto-photo-job.js, before its /publish call. The persisted error contains no nested cause/code, so the precise network failure (DNS/reset/proxy etc.) cannot be determined. No live job was deleted or retried during this work.

## Files changed
- factory-cloud/migrations/0031_psychology_item_deletion.sql
- factory-cloud/src/psychology-auto-publish.js and psychology-publish-groups.js
- public/psychology-auto-publish.js and .css
- API and behavioral UI tests

## Tests performed
Full factory-cloud suite: 432 passed. Covers legacy failure deletion, authorization, idempotency, blocked retries, successful siblings, partial group submission, active/frozen/receipt protection, all-deleted groups, delayed handoffs, and UI confirm/DELETE/refresh. No live publishing APIs invoked in tests.

## Unfinished work / next step
Ship migration and code via npm run deploy after push to main; verify the live Delete button read-only. No local worker restart is required.
