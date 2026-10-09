# Frame-rendered video preview in recreation details — 2026-10-09

## Goal
Display completed image/copy video renders inside their recreation detail page and mark them 已合成视频.

## Decisions
- Both imported clips and current frame renders use the detail player above the original/recreated frame comparison. Rendering and transfer states appear in the same panel, with a completed-render badge separate from publication state.
- The existing version jobs GET returns its current public version and an owner-scoped render-preview projection. Matching source/version revisions are required; stale or cleaned versions expose no video URL. Active existing cloud previews remain usable if the original job was pruned. GET performs no mutation.
- The page reuses the existing private library preview/import endpoint. When a completed render has no preview asset, it prepares once automatically; existing transfers are observed, failures require explicit retry, and refresh reuses ready storage. No new rendering or publishing jobs are created by preview; only the existing archive transfer lane is used.
- Poll only visible detail pages while rendering or preview preparation is pending, stop on readiness/failure/cleanup, discard stale reads, and preserve native playback position on status updates. Shared lazy browser covers show a frame before playback without cloud thumbnail files.
- Source/versions retain input type 图文 after rendering. Existing once-only publication, confirmed-success cleanup, paused planning and running workers are unchanged. No migration.

## Files changed
factory-cloud/src/psychology-video-hit-production.js and psychology-video-hits.test.js; public/psychology-video-hits.html/.js/.css; scripts/psychology-video-hits-ui.test.js; generated UI asset manifest; architecture/current state and this handoff.

## Tests performed
- 66/66 focused video-hit, video-library, cleanup and UI asset tests passed. Coverage includes current identity, queued/ready/failed transfer, stale source/version, foreign-owned preview assets, cleanup exclusion, archived render jobs and side-effect-free reads.
- Browser fixture verifies automatic completion display, a single initial preparation, explicit retry after failure, reused cloud playback, retained frame comparison, stale/cleaned player removal, no publishing from previews and existing imported-video/publication flows.
- Desktop 1440px and mobile 390px/320px layouts inspected; shared theme button padding corrected for the cover player. Final real Chromium flow passed; fixture-only publication APIs, no real publishing. UI asset check also passed 7/7.

## Release evidence
Implementation d14d5c9b7ebdc13f9af84ad61d96a7a130dd527b was committed and pushed to GitHub main before deployment. The clean release clone had exact HEAD == origin/main and ran npm run deploy from factory-cloud successfully. Cloudflare version cec7fae5-e67d-42c9-a606-51ecad1633b9. Live detail JS/CSS and shared poster module SHA256 matched the release; detail route redirected to login and anonymous jobs/private media reads returned 401. Existing transfer PID 100756 retained its original 2026-10-08 17:13:34 start time. No real publication was submitted.

## Unfinished work
Implementation, tests, deployment and read-only production verification complete. No unfinished work.

## Recommended next step
Refresh an existing completed image/copy recreation detail. Ready cloud clips play in place; local-only renders prepare a preview automatically and offer explicit retry on failure.
