# Local Factory official publishing bridge compatibility

## Goal

Fix Local Factory official TikTok tasks failing after upload with `TikTok official bridge returned HTTP 404`.

## Decisions

- Preserve the Local Factory client's existing `/api/v1` contract instead of changing active local publishing jobs.
- Require the existing Local Factory bridge key on every compatibility route.
- Only expose active TikTok connections that include `video.publish`.
- Copy each temporary upload to a task-specific R2 object before queueing so one account's cleanup cannot remove media needed by another account.
- Keep idempotency at `batch externalId + item externalRef`.

## Files changed

- `tiktok-analytics-cloud/app/api/v1/accounts/route.ts`
- `tiktok-analytics-cloud/app/api/v1/publish/assets/route.ts`
- `tiktok-analytics-cloud/app/api/v1/publish/batches/route.ts`
- `tiktok-analytics-cloud/lib/local-factory-bridge.ts`
- `tiktok-analytics-cloud/lib/local-factory-publish.ts`
- `tiktok-analytics-cloud/tests/local-factory-publish-bridge.test.mjs`

## Tests performed

- Cloud source tests: 18 passed.
- Local Factory official publishing tests: 8 passed.
- TypeScript: passed.
- ESLint: passed with 9 pre-existing warnings and no errors.
- Vinext production build: passed; all three `/api/v1` routes were registered in the route manifest.
- No real TikTok or GeeLark publishing call was made during verification.

## Unfinished work

- Deploy the new Worker build.
- Verify an unauthenticated request to `/api/v1/accounts` returns `401` rather than `404`.
- Resume the failed Local Factory task only after the production smoke check passes.

## Follow-up: transient upload failure

### Goal

Make official TikTok publishing recover from transient network failures that previously surfaced only as `fetch failed`.

### Findings

- Task `8.11-tkapi-1` completed local generation (`1/1`) and failed while uploading the generated video to the official publishing bridge.
- The configured Worker endpoint and authenticated account-list request both returned HTTP 200 during read-only diagnostics.
- The failure was therefore in the upload network request, not video generation, account authorization, or a missing bridge route.

### Files changed

- `scripts/official-tiktok-analytics.js`
- `scripts/official-tiktok-analytics.test.js`

### Decisions

- Retry network-level upload and batch-creation failures twice, with 2-second and 5-second backoff.
- Recreate the video read stream for every upload attempt.
- Do not retry HTTP response errors.
- Replace raw `fetch failed` output with a stage-specific Chinese error containing the attempt count and underlying network code.

### Tests performed

- `node --test scripts/official-tiktok-analytics.test.js scripts/auto-task-official.test.js`: 9 passed.
- Authenticated read-only Worker account request: HTTP 200, one authorized account returned.
- Local service restarted and `/tasks` returned HTTP 200.
- No real TikTok publishing request was submitted during verification.

### Recommended next step

Use `继续执行` on the failed task. The saved generated video should be reused, so the task resumes at publishing rather than rendering it again.

## Recommended next step

Deploy `tiktok-analytics-cloud`, run the non-publishing route smoke check, then use `继续执行` on the failed Local Factory task.
