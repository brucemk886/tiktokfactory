# Saved Video Hits photo publishing — 2026-10-09

## Goal
Publish imported video-hit recreated frame sets through the existing manual batch-photo flow, preserving saved pictures/copy without generating images or an MP4.

## Decisions
- Normal creation page → 图文 → 视频爆款 · 二创图文; ordered image previews, saved caption review, page select/clear and cross-page preservation. Twelve versions/page, 100 posts/batch, 1–35 images/post. Ineligible albums show reasons.
- Session-only owned inventory, fresh administrator/module/account gates, revision validation, source CAS, atomic version reservations and image pins. Photo and video share one publication identity; retries retain the original batch/item IDs.
- Dedicated cloud-photo runner reuses JPEG/WebP bytes and converts existing PNGs to JPEG (white background, max 4096 px, same proportions). No rendering templates, copy rewriting, TTS, composition or old planning activation.
- Existing official Hub asset upload, persisted checkpoints/backups, groups of twenty and round-robin accounts/schedules/music. AI declaration included. Legacy generated-photo maximum remains six.
- Official confirmation +24h cleanup removes recreated images/copy and completed frozen job pages/plan fields. Existing original/shared/active-reference guards remain. No migration or worker restart.

## Files changed
- New factory-cloud/src/psychology-video-hit-photos.js, psychology-hit-photo-runner.js and focused photos tests.
- Existing auto-publish/auto-photo/cloud-queue/cloud-renderer/photo-publishing services, production inventory router and cleanup snapshot fields.
- public/psychology-hit-photo-picker.js plus auto-publish HTML/JS, publish-create CSS and generated asset manifest.
- Input normalizer, UI harness/browser regression fixture, npm test list and architecture/current/API docs.

## Tests performed
- Focused backend integration covers inventory/order/limits, atomic CAS/storage races, permissions, same-version video/photo exclusion, request replay, queue recovery, actual mocked Hub photo payloads, PNG conversion/checkpoint restoration, private/redirect/size reads and cleanup grace.
- 35-photo boundary and grouped two-account/music/stagger assignments verified without external publishing.
- Chromium mocked-server test covers ordered previews, page select/clear, cross-page preservation, disabled 36-photo albums, exact submission refs, cancel-before-confirm, desktop/mobile layouts and real PNG-to-JPEG conversion. Existing One/video selection/cover tests also pass. Screenshots in primary tmp/hit-photo-ui-qa; no real Hub/GeeLark publication.
- Full declared regression suite: 1374/1374 passed with four test workers. Initial high-concurrency run had one unrelated existing video-detail navigation timeout; isolated rerun and full controlled rerun passed. Final focused UI/API/asset checks: 47/47. Manifest/diff checks passed.

## Release evidence
Runtime commit 3ed7011ab049c2e33eb28e275f20e48fac4493fc was committed and pushed to GitHub main, then deployed from a clean exact HEAD == origin/main release worktree using npm run deploy in factory-cloud. Cloudflare version d4c4ef2c-b161-40aa-ba32-ef94dad40cf6. No migrations were needed. Live main JS, new photo picker JS and CSS hashes matched; photo-library returned 401 anonymously and the creation page redirected to login. Transfer PID 100756 retained its original 2026-10-08 17:13:34 start time.

## Unfinished work
Implementation, testing and deployment complete. No actual account publication was performed for QA.

## Recommended next step
Refresh the normal creation page and select enabled unpublished recreated photo albums.
