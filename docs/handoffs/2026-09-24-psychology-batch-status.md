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
