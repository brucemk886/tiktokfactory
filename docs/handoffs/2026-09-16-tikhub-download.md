# TikHub server-side TikTok download

## Goal
Resolve TikTok page/share URLs through TikHub and download the actual MP4 inside Cloudflare for the existing psychology recreation workflow.

## Decisions
- Use `/api/v1/tiktok/app/v3/fetch_one_video_by_share_url` with the server-only `TIKHUB_API_KEY` Worker secret. No key is stored in source, Git or this report.
- Resolution is a separate durable step with no automatic paid retries. CDN alternatives and download retries reuse that result.
- Prefer H264; validate HTTPS TikTok CDN hosts and each redirect. Never forward the API key to the CDN. Use manual redirects because the deployed Workers runtime rejects the `error` redirect mode.
- Validate MP4 headers, response type, byte counts and a 300 MB limit. Use bounded 8 MB multipart uploads for large videos, aborting and deleting partial objects on failure.
- Page-only peer records can enter the cloud recreation workflow when TikHub is configured. Existing direct-file records still work without TikHub.
- Retain Google video analysis with Kie fallback, Z-Image and ElevenLabs; stop at the review board. Record actual source cleanup status.
- Preserve HTTP status in Google error messages and recover it after durable step error serialization, so 429/5xx retry and fall back correctly. Permanent 4xx errors do not trigger paid fallback.
- No Docker, new VPS or automatic GitHub deployment service.

## Files changed
- Added `factory-cloud/src/tikhub-video-source.js`, `tiktok-video-download.js`, and focused tests.
- Updated recreation workflow, submission validation, existing tests, npm test command and peer-page explanatory text.
- Updated Gemini client/workflow error classification and serialization regression tests.

## Tests performed
- Full cloud suite: 314 tests pass, no failures or skips.
- Tests cover private-key scope, unsafe URLs/redirects, partial/invalid/oversized MP4, multipart and failure cleanup, page-only queueing, idempotency and full mocked recreation.
- An authenticated live TikHub call returned HTTP 200; the price API confirmed USD 0.001/request at 100 requests/day.
- Production Cloudflare workflow downloaded the full 2,586,843-byte MP4 from the existing peer record `psy-2c70c5e722a7faacbad0fbde906b516b`, stored it in R2 and uploaded it to Google. No local media file was used.
- That verification reached Google analysis but received HTTP 524. Original R2 video deletion was confirmed by the completed cleanup step and `sourceDeleted: true`; the temporary analysis row was removed.
- This exposed durable step errors losing custom HTTP status fields. Regression tests now simulate that boundary and confirm three Google attempts followed by Kie fallback, including HTML 524 and generic 503 responses.

## Deployment verification
- TikHub secret configured in production. Code commits `f7061f3` and `6640b96` pushed to GitHub main and deployed with `npm run deploy` from clean clone `work/tikhub-release/factory-cloud`.
- The original checkout contains pre-existing untracked `artifacts/`, preserved. The release clone avoids deploying from a dirty worktree and must match GitHub main exactly.
- Production health check returned HTTP 200. Workflow `factory-psychology-recreation` is registered.
- Test task: `peer-tikhub-check-256bd1d1b9924515`; only this explicitly labeled test task was retried. No user publishing job was changed.

## Unfinished work / next step
Download and cleanup are verified in production. Deploy the HTTP-status fallback fix and verify a final recreation attempt; do not claim generated image/audio completion until that attempt finishes. Use `/psychology-peer-hits` -> select video -> choose narration voice -> recreation, then review `/psychology-production`.
