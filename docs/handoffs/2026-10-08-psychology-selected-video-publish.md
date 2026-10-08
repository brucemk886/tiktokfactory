# Psychology selected-video review and TikTok One publication

## Goal
Provide an interactive workflow on the psychology automatic-publishing page before enabling future template automation. Support both local video uploads and completed factory videos, preview first, select thousand-follower accounts, and explicitly confirm project-linked publication.

## Decisions
- New “选视频 · TikTok One 发布” entry. Local uploads and source-worker archive requests only populate a private video library. No automatic publication or old autopilot resume.
- One project per batch, 1–20 selected videos. Each video has an explicit account, caption, AI-generation flag and time; optional round-robin assignment is visible and editable before confirmation. Project metadata uses existing authorized brand/project data. The user later requested that the dropdown show only project IDs 7693454687705595917 and 7584639271164739598; the UI now filters to those two anchored projects.
- Live read confirmed requested projects 7693454687705595917 (deeppersonaai) and 7584639271164739598 (Deep Persona AI - Visual Personality Insights) are offered as anchored projects. Account-level eligibility still needs official prepare/join checks.
- Thousand-follower data comes from current factory archive, with missing values and sync times shown explicitly. Creation validates current grants, the threshold, owned ready assets and project membership before any publishing batch exists.
- Stable owner/request id and frozen inputs protect retries. Archived output paths are worker-local, validated, and pinned to their source worker. Uploads are 95MB max per MP4/MOV/WebM; private R2 preview supports ranges. Added capability prevents old workers taking unfamiliar tasks.
- Existing template generation, published content, schedules, pauses and caption-only conversion flow remain intact. New future daily automation is intentionally deferred until the user validates this interactive path.

## Files changed
Private video-library service, migration 0079, follower metadata/gate, explicit publishing endpoint, existing worker protocol/type integration and optional standalone transfer helper; interactive picker and publication page; focused backend/UI/worker tests, asset manifest, architecture/current state.

## Tests performed
Focused tests use only in-memory SQLite, synthetic video and fake API services. Browser test plays a generated MP4, imports a factory result, uploads locally, selects accounts/projects, edits captions, cancels once then confirms, checks exact mapping and desktop/mobile layout. Full regression: 1,289/1,289 passed. Worker/helper tests: 13/13 passed. The desktop/mobile selected-video browser test passed, including actual synthetic MP4 playback, exact publication mapping, and cancel-before-confirm. No real publishing or generation APIs were called. Production release results will be appended after deployment.

## Unfinished work
User must run a real selected-video publication and confirm TikTok project/anchor display. No real TikTok publication is performed by tests. Factory preview files require their source worker (or the scoped sidecar) online; other machines need updated worker code. Long-term video library retention remains manual in this initial version; do not delete stored videos without an explicit retention policy.

## Recommended next step
Use the new picker for a small reviewed batch on one project, verify actual receipts and anchor presentation, then design future template-based daily automation from the validated flow.

## Production release and verification
- Runtime commit `1840a6d15da39521ed85d3ffbc3c4cdd2542b572` was pushed to GitHub main. The deploy gate confirmed a clean worktree and exact HEAD/origin/main equality. Deployed with `npm run deploy`; migration 0079 applied. Cloudflare version: `44e742b7-d177-4718-ae3c-1c2ca52f9d8d`.
- Logged-in production UI verified both source tabs, the two requested projects, and 21 eligible thousand-follower accounts out of 201 currently scoped accounts. No actual video was uploaded/published in production, no project membership changed, and no old planning resumed. No app JavaScript errors observed (unrelated browser extension and favicon errors only).
- Investigated the empty generated-video list: all 3,861 existing completed psychology jobs are cloud-browser photo jobs with empty video results. This is expected, not a legacy result-shape bug. Future completed video jobs populate the picker; locally generated files can be uploaded now.
- A hidden, scoped transfer helper is running for the current session (PID 100756), using the existing local worker identity/configuration. It claims only explicit video preview/selected-video tasks; existing workers were not restarted. Initial transient network errors were followed by no further errors during verification. Logs: the Windows temp directory, psychology-video-transfer-live.log and psychology-video-transfer-live-error.log.
- The helper is not registered for Windows autostart. Keep this managed worktree available while it is running. After a future natural local-worker upgrade/restart, the integrated worker supports these tasks directly and the helper can be retired. Other source worker machines must also use updated code for their local video previews.

## Follow-up: restrict anchor project choices
- Goal: show only the two psychology projects specified by the user in the publishing-page anchor selector.
- Decision: filter the authorized, paginated project results to the exact two IDs and retain the existing anchor check. Other projects remain available in the central TikTok One module; no existing task is modified.
- Files: public/psychology-tiktok-one.js, its generated UI asset manifest, and the existing selected-video UI regression fixture.
- Verification: the browser fixture includes an unrelated anchored project and checks that opening and refreshing the selector both expose only the requested two projects. The selected-video browser regression passed, including both selector checks and the existing preview/confirmation flow. UI asset tests passed; only synthetic services were used.
- Unfinished work / next step: real reviewed publication remains for the user's interactive validation.
