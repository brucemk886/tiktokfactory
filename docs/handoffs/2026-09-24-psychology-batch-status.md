# Psychology batch status after missing execution records — 2026-09-24

## Goal
Investigate psychology automatic publishing batches incorrectly shown as queued after publication.

## Evidence and decisions
- Read-only production browser API checks found five batches with submitted/missing item counts: 10/10, 15/15, 19/1, 29/1, 18/2. Total 91 submitted receipts and 29 missing execution jobs.
- First batch source-report API confirms 10 published posts and 10 cleaned/missing records. Cannot assert that all 120 posts published, or determine the historical deletion cause from current evidence.
- UI previously defaulted missing/unknown statuses to queued. Now shows 状态待核实 with explicit counts; does not offer a retry for missing records.
- Batch API consults durable factory_publish_records by exact autoTaskId and matching autoBatchId when available. A nonempty batchId is required; no inference by title/account. Attention filter includes unresolved orphan records.
- No publishing requests, retries, queue interruptions or production data writes were performed.

## Files
- factory-cloud/src/psychology-auto-publish.js and .test.js
- public/psychology-auto-publish.js, .html, .css
- scripts/psychology-auto-publish-ui.test.js

## Validation
- Full factory-cloud suite: 631 passed.
- Read-only live browser verified five affected batches and first batch published/cleaned state.
- Wrangler remote D1 query failed with 7403 (current OAuth account not authorized to this production database). Deployment verification pending.

## Next step
Deploy committed main when production Cloudflare access is available; then investigate remaining 29 missing items against original hub records before deciding any recovery. Do not republish blindly.
## Deployment completed
- Commit d66b5e0 pushed to main; standard npm deploy passed clean HEAD==origin/main guard.
- Production version e1553def-98fc-42b0-93b6-9dbe82447c6c.
- Explicit --config wrangler.jsonc resolved the earlier CLI account selection problem; production read-only queries succeeded. Future D1 commands must include that config.
- Live page verified: queued 0, attention 5, five affected batches show 状态待核实; the two complete batches remain 已提交. No browser error message.
- Remote SQL confirms execution jobs are missing for all historical items, but durable receipts retain submitted status for 113 overall (91 in the five affected batches). Twenty-nine affected items lack a usable receipt. Historical deletion cause remains unproven; 30-day scheduled pruning does not explain these recent dates by itself.
- Remaining work is investigation of those 29 outcomes against hub records; UI intentionally does not claim publication or enqueue recovery.
## Batch submission and individual outcomes — follow-up
- User requested partially successful batches still show 已提交, with explicit success/failure counts.
- A batch with at least one submitted item and no active generation/submission/retry now shows 已提交 despite failed or missing siblings. Active work retains existing running/attention behavior.
- API returns each item's publication outcome from its exact durable record, validating autoBatchId. Local generation failure also counts as failure; a missing job without a result never fabricates success/failure.
- Table and detail display 发布成功 / 发布失败, plus 发布中 or 未返回结果 when applicable; per-item detail shows the actual publication outcome.
- Production read-only evidence: 0922-0920-3-20 = 10 published/10 unavailable; 0922-心理学-2-30 = 14 published/2 failed/14 unavailable; 0922-0918-20 = 19 published/1 unavailable; 心理学-2 9.21 30条 = 28 published/1 failed/1 unavailable; 0920-3-9.21 20条 = 17 published/1 failed/2 unavailable.
- Full regression suite: 631 passed. No publication/retry triggered.

## Initial task-list loading state
- Initial HTML and pre-response rerenders show loading, placeholder metrics and disabled pagination instead of a false empty state.
- Successful empty response alone shows 暂无发布任务. Initial request failure shows an explicit refreshable error; subsequent refresh failure retains already loaded rows.
- UI regression suite: 21 passed, including delayed first response and network failure. Modified public/psychology-auto-publish.html/.js and scripts/psychology-auto-publish-ui.test.js.

## Task-list load latency optimization
- Before-change live Resource Timing sample: options 2153 ms, then task list 6611 ms; accounts 2287 ms. Task list started only after options finished.
- Frontend now starts list/accounts/options concurrently and isolates failures with allSettled. Visible list no longer waits on creation-form options.
- Backend queries selected page using count+batch read, all items+groups read, then one durable-record read: 5 SQL statements in 3 database calls versus 23 calls for the current 7 batches. No changes to selection, permission scoping, status or publication behavior.
- Full suite 635 passed, including constant query-count/membership regression and slow options rendering regression.
- Files: factory-cloud/src/psychology-auto-publish.js/.test.js, public/psychology-auto-publish.js/.html, scripts/psychology-auto-publish-ui.test.js.
