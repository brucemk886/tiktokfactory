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
Push main, deploy and verify live CSS.

## Recommended next step
Refresh Video Hits and click a video cover to play it.
