# Psychology selected-video review and TikTok One publication

## Goal
Provide an interactive workflow on the psychology automatic-publishing page before enabling future template automation. Support both local video uploads and completed factory videos, preview first, select thousand-follower accounts, and explicitly confirm project-linked publication.

## Decisions
- New “选视频 · TikTok One 发布” entry. Local uploads and source-worker archive requests only populate a private video library. No automatic publication or old autopilot resume.
- One project per batch, 1–20 selected videos. Each video has an explicit account, caption, AI-generation flag and time; optional round-robin assignment is visible and editable before confirmation. Project dropdown uses existing authorized brand/project data, not hardcoded IDs.
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
