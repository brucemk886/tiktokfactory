# TikTok One project-linked publishing release

Date: 2026-09-08
Goal: Implement confirmed official project-linked video publishing so the user can select a creator and video for a real anchor test.

Implemented and deployed in sibling D:/cursor/tiktokaitool. Commit9a2a48b pushed to origin/main. Clean worktree and exact HEAD==origin/main verified before npm run cloudflare:deploy. Cloudflare version99f02f27-35ac-42eb-974c-7b22e1a4ade4. Existing local TTO table redesign included.

Entry: TikTok One > collaboration projects > row Publish video. Admin chooses creator; checks settings; joins via creator API or explicitly confirms prior invitation membership; uploads one MP4/MOV/WebM up to95MB; publishes with canonical server-fetched tto_invite_link and branded-content disclosure. Uses existing signed media, quota, durable queue, idempotency and status polling. Project history contains status, video ID and public URL. Creator join dedupe handles success, definite rejection and uncertain result separately. Separate creator campaign permission may still be needed; no new permission is falsely assumed from brand scopes.

Checks: production build and188/188 tests passed, TypeScript/focused ESLint/diff-check passed. Isolated mocked browser passed no-default-account, settings, join-once, upload synthetic4s video, publish-once, status, public URL and mobile390px width; screenshot inspected. Production read-only smoke: new JS bundle200 containing publish entry; unauthenticated admin publish API401 with no-store. No real TikTok join/publish/approval performed.

One build exceeded host native memory; retried successfully with RAYON_NUM_THREADS=2. No active rendering/publishing job interrupted.

No database migration. Detailed file list and decisions: sibling docs/handoffs/2026-09-08-tiktok-one-publishing.md.

Unfinished: user-selected live test, actual anchor visibility/metrics in eligible region, and determination whether real project still requires brand approval. Automatic brand approval has NOT been implemented; creator join and content linking must not be labeled brand approval.
