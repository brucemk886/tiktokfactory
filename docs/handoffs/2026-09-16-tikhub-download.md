# TikHub server-side TikTok download

## Goal
Resolve TikTok page/share URLs through TikHub and download the actual MP4 inside Cloudflare for the existing psychology recreation workflow.

## Decisions
- Use `/api/v1/tiktok/app/v3/fetch_one_video_by_share_url` with the `TIKHUB_API_KEY` Worker secret. No key is stored in source, Git or this report.
- Resolution is a separate durable step with no automatic paid retries. CDN alternatives and download retries reuse that result.
- Prefer H264; validate HTTPS TikTok CDN hosts and each redirect. Never forward the API key to the CDN.
- Validate MP4 headers, response type, byte counts and a 300 MB limit. Use bounded 8 MB multipart uploads for large videos, aborting and deleting partial objects on failure.
- Page-only peer records can now enter the cloud recreation workflow when TikHub is configured. Existing direct-file records still work without TikHub.
- Retain Google video analysis with Kie fallback, Z-Image and ElevenLabs; stop at the review board. Record actual source cleanup status.
- No Docker, new VPS or automatic GitHub deployment service.

## Files changed
- Added `factory-cloud/src/tikhub-video-source.js`, `tiktok-video-download.js`, and focused tests.
- Updated recreation workflow, submission validation, existing tests, npm test command and peer-page explanatory text.

## Tests performed
- 310 automated tests passed before the final cleanup-state adjustment; the affected download/workflow tests also pass after that adjustment.
- A prior authenticated live TikHub call returned HTTP 200 and a real MP4 range response; price API confirmed USD 0.001/request at 100 requests/day.
- The temporary Wrangler remote-preview tunnel timed out even for an unauthenticated GET; this did not validate or invalidate the cloud downloader.

## Deployment verification
Tracked in the follow-up deployment result. Production must be deployed from a clean GitHub main checkout using `npm run deploy`.
