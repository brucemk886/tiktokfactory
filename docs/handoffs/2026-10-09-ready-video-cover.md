# Ready gallery video playback cover fix

## Goal
Fix gallery videos producing audio while a static cover remains over the playing picture.

## Decisions
The gallery-specific display:block!important rule overrode the shared [hidden] rule even after the playback handler hid the cover. Remove only the display priority so the existing hidden behavior wins; retain all cover sizing and spacing. Video files, media endpoints and publishing are unchanged.

## Files changed
- public/psychology-video-hits.css and generated factory-cloud/src/ui-asset-manifest.js.
- scripts/psychology-video-hit-ready-ui.test.js: use a moving H.264/AAC clip and assert cover visibility, hit-testing, changing decoded frames and accessible video controls after pause on desktop and mobile.

## Tests performed
- Before the fix, Chromium reproduced the regression: currentTime advanced, but the cover computed display was block instead of none.
- Focused gallery and UI asset checks: 8 passed, zero failures. Desktop (1440px) and mobile (390px) both confirm a hidden cover, click-accessible video, progressing frames and native controls after pause. Test fixtures only, no real publication.

## Unfinished work
None.

## Recommended next step
Refresh Video Hits and click a video cover to play it.

## Release evidence
Runtime commit 447bf8b5df7e6aa6555b9e61b5c17245bdc2dd54 was pushed to main and deployed from a clean checkout with HEAD == origin/main using npm run deploy. An initial network fetch failure required one retry. Worker version aa20328e-280a-4661-9e00-c4930ccdb709 deployed successfully. Live psychology-video-hits.css returned HTTP 200, matched local SHA-256 and contains the corrected display rule. Concurrent independent-site updates were retained, and the integrated UI manifest check passed. No production publication or material mutation.
