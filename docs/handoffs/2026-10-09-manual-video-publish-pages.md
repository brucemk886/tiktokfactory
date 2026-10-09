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

## Unfinished work
Implementation and tests complete. Commit/push, guarded deployment and production read-only verification follow this handoff; release evidence will be recorded after completion.

## Recommended next step
Use the new page links from Psychology automatic publishing; import and enable recreated clips in Video Hits, then select them for One or draw them in a normal task. Failed submissions reuse the original publishing identity; publication confirmation controls cleanup.
