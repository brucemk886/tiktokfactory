# Goal
Increase psychology automatic cloud photo queue concurrency from two to five at the operator's request.

# Decisions
- Set PHOTO_QUEUE consumer max_concurrency=5; max_batch_size remains one.
- This cap covers the whole consumer pipeline, including rendering, backup, hub upload and submission. It is not an independent browser-only pool.
- Keep 20-post publication groups and two business retries. Do not restart local workers or cancel jobs.
- This supersedes the original cloud photo handoff's recommendation to remain at two. Existing concurrency-two benchmark results remain historical evidence, not a concurrency-five throughput measurement.

# Files changed
- factory-cloud/wrangler.jsonc
- factory-cloud/src/psychology-cloud-queue.test.js
- docs/CURRENT_STATE.md
- docs/ARCHITECTURE.md

# Tests performed
15/15 cloud queue tests passed, including duplicate delivery, deferred retry, checkpoint resume, mocked hub submission and the updated concurrency configuration assertion. No real publication requests were made by tests.

# Unfinished work
Five-consumer production throughput and hub latency have not been load-tested. Deployment confirmation is reported in the task response.

# Recommended next step
Observe operator-created batches for actual queue duration and upload errors before further increasing concurrency. Roll back the cap to two through the normal commit/push/deploy process if required.
