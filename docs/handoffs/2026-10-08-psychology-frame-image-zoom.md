# Psychology frame image zoom and edit explanation — 2026-10-08

## Goal
Explain the manual frame editor and add a magnifying glass to enlarge original/recreated images inside the detail page.

## Decisions
- Each existing frame image is now a keyboard-accessible button with a magnifier. It opens the same private image in a native dialog instead of a new tab. Missing-image placeholders remain separate.
- The viewer offers zoom in/out, fit to viewport and original pixel dimensions, with scrolling contained inside the dialog. Escape, close and backdrop dismiss it; focus returns to the original image button. Mobile resize maintains fit when appropriate.
- Frame actions now say 修改原图 / 修改二创图. The editor explicitly explains replacement, text/timing edits, absence of automatic image generation, and the existing disable scope: original-frame changes disable all source versions; recreation changes disable that version. Editing an existing frame locks its index; add-frame controls retain index entry.
- Previewing/zooming issues only existing authorized image reads. No API, queue, generation, publication or worker changes.

## Files changed
- public/psychology-video-hits.html/js/css; generated factory-cloud/src/ui-asset-manifest.js.
- scripts/psychology-video-hits-ui.test.js; CURRENT_STATE and the video-hits API usage guide.

## Tests performed
- 18/18 focused UI/backend/private-asset tests passed.
- Actual Chrome tests both original/recreated image sources at1440/390/320: zoom sizes, original-size scrolling, fit/keyboard controls, dialog bounds, Escape/backdrop closure and focus return. Content mutation receipt count and job count stay unchanged while viewing. Editor help and fixed frame index verified.
- Existing three-page navigation, ordered twenty versions, uploads/enable/render into isolated queue, frame21 pagination and invalid links still pass. No external/model/publication request made.
- Viewed desktop/mobile screenshots under ignored tmp/video-hits-qa, including image-preview-1440/390/320.png. Test log: D:/cursor/localfactory/tmp/video-hits-preview-tests.log.

## Unfinished work
No feature work remains. Release verification is recorded below.

## Recommended next step
Open 二创详情 and click an original/recreated image or its magnifier. Use 修改 only to replace a frame or adjust its stored text/timing, then review and re-enable the affected version.

## Production release verification
- Runtime commit `32d7bdc399955e04f0853d5c6cf1782f6d6aecbc` was pushed to GitHub main first. Standard `npm run deploy` ran from the independent clean main release checkout with exact HEAD == origin/main preflight; no migrations needed.
- Worker/assets and all existing triggers deployed successfully. Production version `7e3c67ee-f513-4447-8b33-3c23f4305039`. Log: D:/cursor/localfactory/tmp/video-hits-preview-deploy.log.
- Logged-in production read-only verification used an existing frame: original720x1280 and recreation1080x1920 both opened and decoded in the new modal. Original zoom changed56%→71%; original-size view used720px and scrolled inside a390px viewport. Modal stayed between12px and378px with390px document width. Recreation opened at fit scale29% on mobile.
- Previews and controls were closed after QA. The task-created browser session and foreground control daemon were stopped. No live content writes, enable/render/publication or paid provider calls were made.
