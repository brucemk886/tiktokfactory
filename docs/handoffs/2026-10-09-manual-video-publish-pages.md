# Manual video publishing pages — 2026-10-09

## Goal
Add video-hit recreated clips to the manual TikTok One picker and normal publish-task content sources. Replace both creation dialogs with dedicated, usable pages that expose selected-video previews and caption/account editing.

## Decisions
- Existing list navigates to /psychology-publish?create=one or ?create=normal. A page heading, step links, larger controls, video library cards, upload action, selected count/jump, selected preview/caption cards and mobile layouts replace the cramped modal. Batch detail remains a dialog.
- One defaults to private video-hit recreations; generated and local uploads remain available. Preserve selections across sources, carry saved caption and immutable origin/asset identity, allow per-item caption/account/AI review, require manual confirmation and existing project/follower checks.
- Normal creation adds video-hits + selected-video, count/order/query/accounts/schedule and explicit AI disclosure. Direct imported clips and current completed renders bypass generation; local render reuse stays on its original worker. Insufficient unique candidates creates no task. No persistent helper, planning or daily automation is enabled.
- A shared service resolves eligible content and atomically reserves the existing source/version/render identity, active asset and imported owner/file digest with all batch/group/item/jobs. All entrances share existing once-only records and confirmed-success +24h cleanup. Selected batch configs store caption digests for replay, keeping actual text only in the existing cleanable payload. No migration.

## Files changed
- public/psychology-auto-publish.html, psychology-auto-publish.js, psychology-video-picker.js; new psychology-publish-create.css; generated UI manifest.
- New factory-cloud/src/psychology-video-hit-publishing.js; video-library and auto-publish handlers; auto-publish normalizer and API catalog.
- Database publishing tests, UI unit harness and standalone Chromium flow test; API guide, architecture and current state.

## Tests performed
- Full factory suite: 1360/1360 passed, no skips/failures.
- Final manifest/UI unit checks: 34/34 passed after tracking the new stylesheet.
- Dedicated Chromium selection flow passed: standalone navigation; carried/edited caption and version ref; playback; cross-source selections; account/project checks and cancellation; normal draw without One; 1440/390/320 overflow checks. Header and selected-review desktop/mobile screenshots inspected in primary tmp/manual-video-ui-captures.
- Added real SQLite transaction coverage for shortages, same-file collisions, stale revision/asset substitution, ownership/permission, concurrent edits/render replacement, replay, local completed render reuse and success-grace cleanup. All external media/publication calls used isolated fixtures.
- Existing video-transfer node PID 100756 still has its original 2026-10-08 17:13:34 start; no worker interrupted.

## Release evidence
- Implementation f72dfe4020d657c6b230ca9d8dbe1753b6fb4b19 and final selection-help refinement 5082cf358465a49414b319553fcd4f6f60825407 were committed and pushed to GitHub main before deployment.
- Final runtime 5082cf3 deployed from a clean release with exact HEAD == origin/main using npm run deploy. Cloudflare temporary fetch failures required retries, including one partial trigger sync; the final full command succeeded (exit 0), version 90261c44-88a6-4a63-a4bf-8a0c57600fad.
- Production JS for auto-publish/picker and the new CSS matched local SHA256. Both creation URLs redirect unauthenticated visitors to login; video-hit inventory, private asset read and creation options return 401 without authentication. No real publication submitted.
- The final copy-only refinement passed the dedicated browser test and 7/7 asset tests. Existing helper PID 100756 was unchanged after deployment.

## Unfinished work
Implementation, testing, deployment and production read-only verification are complete. No unfinished work.

## Recommended next step
Use the new page links from Psychology automatic publishing; import and enable recreated clips in Video Hits, then select them for One or draw them in a normal task. Failed submissions reuse the original publishing identity; publication confirmation controls cleanup.
