# Psychology publishing retries and complete failure records — 2026-09-19

## Goal
Automatically retry psychology upload/submission failures twice without holding the execution lane during backoff, and include failures that never received a remote batch ID in official API records.

## Decisions
- Migration 0032 gives factory_jobs durable available_at, auto_retry_count and retry_history_json fields. Claims skip jobs whose delay has not elapsed. Psychology photo workers and video publish jobs release their slots after failure and retry after 30/60 seconds (actual pickup follows worker polling/capacity). Maximum three attempts per automatic retry cycle. Manual retry starts a new cycle.
- Failed grouped submissions use a separate psychology-publish-submit job on the publish lane. Only updated workers advertising psychologyPublishRetry can claim it. Uploaded assets and the frozen remote request/externalId are reused. A concurrent upload callback cannot bypass a pending group retry. No sleeping worker slot is reserved between retries.
- Completion is guarded by running status and worker ownership; duplicate completion does not consume retry budget. Cancelled/deleted items and ordinary non-psychology jobs are excluded. Existing publishing permissions remain checked at execution.
- Failure records use stable psychology:<itemId> IDs even without remote receipts. A later success updates that record and clears the current error/retry marker, with attempt history retained on the job. Group failures record each affected item. Legacy video incoming receipts are mapped to the same stable ID.
- The migration backfills missing historical photo/video submission failures without retrying them. The existing 0918-测试-3 failure remains stopped for operator choice. This fixes factory official API records; it does not invent a Signal Desk batch that was never created.
- Photo network errors now preserve the failing phase, HTTP status and nested network codes in the error text. Job retry history stores time, phase and error; official records expose the latest reason and retry state. Tokens in diagnostic text are redacted.
- These retries cover uploads and submissions to the publishing service. Remote TikTok review/publication outcomes remain owned by Signal Desk.

## Files changed
- Migration 0032 and factory-cloud/src/psychology-publish-retries.js
- Jobs completion/claim protocol; psychology photo/group/auto-publish handlers
- Local worker publish lane and photo error diagnostics
- Official records merge/UI and psychology queue retry indicators
- Focused tests; migration test now injects Git state instead of depending on the current repository HEAD

## Tests performed
- Full factory-cloud suite: 436 passed.
- Root worker and official publish record tests: 18 passed.
- Covered exact retry budget/delays, another job claimed during backoff, duplicate completion, identical frozen group requests, success updating one failure record, legacy failure backfill idempotency without requeue, network codes and credential redaction.
- Existing photo resume, permission, deletion and grouped publish tests remain passing. No real publishing or generation calls made by tests.

## Release / next step
Commit/push main and deploy with factory-cloud npm run deploy. Reload only the idle local worker so it advertises the new submission retry capability. Verify the historical failed record exists and the queue remains unchanged; use read-only live UI checks.
