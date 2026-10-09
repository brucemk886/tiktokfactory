# Video Hits photo albums: 15-image admission limit — 2026-10-09

## Goal
Honor the requested maximum of 15 recreated images per photo post, allowing albums above six and ten images.

## Decisions
- New saved-photo submissions and inventory eligibility accept 1–15 ordered frames. Albums of 16+ are disabled/rejected without truncation or partial reservations.
- Update visible help and current API/architecture documentation. Batch size (100 posts), picker pages (12 versions), saved copy/order and once-only cleanup are unchanged.
- Existing frozen jobs retain the prior 35-image transport compatibility to avoid interrupting queued/running publication. The separate generated-photo flow retains its existing six-image limit.

## Files changed
factory-cloud/src/psychology-video-hit-photos.js and its tests; public/psychology-auto-publish.html; scripts/psychology-selected-ui.test.mjs; docs/CURRENT_STATE.md, docs/ARCHITECTURE.md and docs/psychology-video-hits-api.md.

## Tests performed
122 related API/queue/photo/UI/asset tests passed. Explicit cases: 12-image inventory, 15-image grouped submission with caption/music/schedule, 16-image rejection and compatibility with previously frozen 35-image jobs. Chromium desktop/mobile fixture passed ordered 12-image previews, disabled 16-image albums, selection and confirmation, plus existing One/video checks. All publishing APIs mocked. No real publication. Manifest and diff validation completed before release.

## Release evidence
Runtime commit 8b222287ca08b3bd687699c8f3ca830f8427eee4 was pushed to GitHub main before deployment. Clean exact HEAD == origin/main release used npm run deploy from factory-cloud. Cloudflare version ea59a849-cf77-425b-afa0-18ab9c498fcf; modified HTML uploaded, no migrations. Live publishing JS/picker/CSS hashes match, private inventory returns 401 without a session and creation redirects to login. Transfer PID 100756 retained the 2026-10-08 17:13:34 start time.

## Unfinished work
Implementation, verification and deployment complete.

## Recommended next step
Refresh normal publishing → 图文 → 视频爆款 · 二创图文 and select an enabled version with up to 15 images.
