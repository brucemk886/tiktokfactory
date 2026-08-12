# TikTok Official Upload Fixed-Length Stream

## Goal

Fix official TikTok publishing failures reporting `Provided readable stream must have a known length` while uploading generated videos to the hosted media endpoint.

## Decisions

- Keep the local file upload streaming; do not buffer videos into memory.
- Wrap the incoming request body in a Cloudflare `FixedLengthStream` using the already validated `Content-Length` before writing to R2.
- Delete the R2 asset if either side of the stream pipeline fails.
- Treat this failure as pre-publish: no TikTok publish batch is created when the media upload fails.

## Files Changed

- `tiktok-analytics-cloud/app/api/tiktok/publish/upload/route.ts`
- `tiktok-analytics-cloud/tests/rendered-html.test.mjs`

Related official publishing and publish-record work already present in the worktree:

- `scripts/auto-task-manager.js`
- `scripts/auto-task-official.test.js`

## Tests Performed

- `node --check scripts/official-tiktok-analytics.js`
- `node --test scripts/auto-task-official.test.js scripts/publish-provider.test.js scripts/official-tiktok-analytics.test.js` (8 passed)
- `npx tsc --noEmit` in `tiktok-analytics-cloud`
- `npx eslint app db lib worker --ignore-pattern dist --ignore-pattern .next` (0 errors, 9 pre-existing warnings)
- `node --test tests/rendered-html.test.mjs` (16 passed)
- `npx vinext build` (production build passed)

No real GeeLark or TikTok publishing API was called by these tests.

## Unfinished Work

- The hosted `tiktok-analytics-cloud` project has not been deployed in this task.
- The failed local task should only be retried after the hosted upload route is deployed.

## Recommended Next Step

Deploy the verified hosted project, then use **Continue** once on the failed task. The original failure happened before TikTok batch creation, so that retry should not duplicate a TikTok submission.
