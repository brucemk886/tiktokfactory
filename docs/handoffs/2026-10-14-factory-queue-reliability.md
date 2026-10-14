# Factory queue reliability — 2026-10-14

## Goal
Prevent exhausted Factory queue deliveries from disappearing, increase durable scheduling throughput without duplicate allocation, and retain production logs for diagnosis.

## Decisions
- Configure a distinct Cloudflare dead-letter queue for each existing consumer: `factory-psychology-photo-dlq`, `factory-psychology-replies-dlq`, and `factory-psychology-schedule-dlq`. Cloudflare creates missing DLQs during consumer deployment and retains unconsumed failed messages for inspection.
- Keep photo and reply transport retries at three. Reduce the durable schedule transport retry ceiling from twenty to seven; its database-backed application retry ceiling remains five.
- Raise durable schedule consumer concurrency from one to three. Its D1 claim now serializes work with the same owner and makes maintenance globally exclusive, while allowing different owners to execute concurrently. Deferred same-owner work is sent as a fresh delayed message so lock waiting does not consume the failed-delivery budget.
- Enable Worker Logs, invocation logs, and 100% head sampling. Reply and imported-photo failure paths emit structured, Bearer-redacted diagnostics instead of silently retrying.

## Files changed
- `factory-cloud/wrangler.jsonc`
- `factory-cloud/src/psychology-durable-scheduling.js`
- `factory-cloud/src/psychology-durable-scheduling.test.js`
- `factory-cloud/src/psychology-cloud-queue.test.js`
- `factory-cloud/src/psychology-auto-replies.js`
- `factory-cloud/src/psychology-imported-photos.js`
- `docs/CURRENT_STATE.md`

## Tests performed
- `node --test src/psychology-durable-scheduling.test.js src/psychology-cloud-queue.test.js src/psychology-auto-replies.test.js src/psychology-imported-photos.test.js`: 66 passed.
- `npx wrangler deploy --dry-run --config wrangler.jsonc --outdir .wrangler-dryrun`: passed; bindings and configuration parsed successfully.
- `npm test`: 1,563 passed, zero failed/skipped/cancelled.
- `git diff --check`: passed before documentation update and must be rerun before commit.

## Unfinished work
- None for this change. Feishu alert delivery remains a separate deferred task by user choice.

## Production verification
- Commit `01f7e45` was pushed to `main` and deployed through `factory-cloud/npm run deploy`.
- Cloudflare Worker version: `f2d740c0-f1e4-457d-8bb6-d6c6259a31f7`.
- Production `/api/health` returned `ok: true`.
- `wrangler queues list` confirmed all three DLQs exist. Consumer inspection confirmed photo `3/20`, replies `3/5`, and schedule `7/3` for max retries/concurrency, each with its configured DLQ.

## Recommended next step
Review Workers Logs and the three DLQs when a production incident occurs; failed messages remain available for manual inspection during Cloudflare's DLQ retention window.
