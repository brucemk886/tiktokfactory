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
