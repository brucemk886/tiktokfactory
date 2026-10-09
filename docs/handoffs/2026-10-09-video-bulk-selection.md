# Manual video bulk selection — 2026-10-09

## Goal
Add a select-all action to the manual TikTok One video picker so users do not have to check each video individually.

## Decisions
- Add 全选本页视频 and 取消本页选择 above the video grid, with current-page and total selection counts.
- Select only ready previewable videos in current list order, retaining other-page/source selections and limiting the overall batch to 20. If the remaining capacity is insufficient, add only available slots and explain how many current-page videos remain unselected.
- Preserve existing selected video objects, including edited captions, AI labels and account mappings. Page clearing removes only matching current-page entries.
- Disable unavailable actions during loading, uploads and outer publishing work. Empty/all-selected/limit states expose the appropriate disabled buttons.
- Bulk actions only change local selection; no preparation, upload or publication is triggered. Existing explicit review and confirmation remain.

## Files changed
public/psychology-auto-publish.html, psychology-auto-publish.js, psychology-video-picker.js, psychology-publish-create.css; factory-cloud/src/ui-asset-manifest.js; scripts/psychology-selected-ui.test.mjs; docs/CURRENT_STATE.md and this handoff.

## Tests performed
- 48/48 focused UI, video-library and asset tests passed; manifest check and git diff --check passed.
- Real Chromium fixture passed: select 11 ready videos while skipping one pending video; repeat selection preserves edited caption and AI label; cross-page selection fills only nine remaining slots; current-page clear retains 11 previous selections; back navigation restores checks; empty/loading/limit button states; no POST requests from bulk selection.
- Existing fixture also verifies manual publishing/account/project behavior and decoded lazy video covers before playback, bounded concurrency and reuse. No real publishing APIs called.
- Desktop 1440px and mobile 390px screenshots visually inspected under primary tmp/video-bulk-select-captures, with no mobile horizontal overflow.

## Release evidence
Commit 240d22e8d081c0bc9361b84f2fa7df4450ea5235 was pushed to GitHub main before the clean release clone deployed through npm run deploy, with HEAD exactly matching origin/main. Cloudflare version 3782b72f-07df-4306-a4ed-16e4542d53a8. Production auto-publish JS, picker JS and CSS SHA256 matched the release. Anonymous inventory and private video reads returned 401. Existing video-transfer PID 100756 retained its original 2026-10-08 17:13:34 start time.

## Unfinished work
Implementation, testing, deployment and read-only production verification complete. No unfinished work.

## Recommended next step
Refresh the manual TikTok One publishing page and use the new page-level selection controls. Existing workers and paused daily planning remain unchanged.
