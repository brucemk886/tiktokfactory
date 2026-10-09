# Video Hits browser image-text import

## Goal
Replace the source-only 新增视频 primary action with 新增二创导入, allowing GPT Bot to write recreated image-text through the logged-in UI without supplying API credentials.

## Decisions
- Dedicated /psychology-video-hits/import page; main list action and existing-source child-list link open it. Source-only metadata entry remains available through the guide link (?newSource=1).
- New sources declare provenance (default gpt-dot; custom agents supported). Existing-source imports preserve original metadata/provenance and use the next unused recreation number. Switching back to a new source restores the chosen new-source agent label.
- Accept 1–15 PNG/JPEG/WebP frames, at most 8 MiB each, through multi-file selection, image paste or public HTTPS links. Preview, reorder/remove and per-frame text are supported. Optional original files/text and narration use the existing storage contract.
- Use existing session-authenticated source/version/frame/image endpoints. No key entry, new API permissions, schema migration or changes to the Grokbot REST contract.
- A per-page session freezes upload IDs and mutation request IDs, caches completed stages, and retries ambiguous responses with the same input. Freeze the form after submission, prevent save during image decoding, and warn before leaving an unfinished import. Reload does not persist local file selection; the page and guide explain recovery.
- Save disabled inputMode=frames versions. Final reads verify title/caption/script, count, order, text and asset references before showing the result link. Import cannot enable, render or publish; existing version completeness checks remain.
- Route and direct HTML alias require the existing Video Hits grant; API ownership and current authorization remain authoritative.

## Files changed
- New public/psychology-video-hit-import.html, .css, .js and -model.js.
- Video Hits entry points, shared sidebar path mapping, pages/permission aliases and generated UI asset manifest.
- New scripts/psychology-video-hit-import.test.js; existing source/editor browser test uses the retained source-only entry; test registered in factory-cloud/package.json.
- Current state, architecture and canonical/public API guide now describe browser import.

## Tests performed
- Focused model/database/browser/permission/asset suite: 34 passed.
- Complete declared factory suite: 1432 passed, no failures or skips.
- Final provenance-switch refinement plus live-browser import and manifest tests: 14 passed.
- Real SQLite and session handlers cover lost response after commit, interrupted image upload, stable UUID/requestId retries, next-version creation, original/provenance preservation, capacity/archive/ownership/revocation rejection, and zero render/publish jobs.
- Chromium desktop/390px/320px tests cover primary navigation, source creation, file selection, preview/reordering/removal/text, retry after a simulated committed response loss, saved record counts, and another version under the same source. All external requests blocked. Desktop/mobile captures under ignored tmp/video-hit-import-qa were visually inspected.
- UI manifest regenerated; git diff --check passed. No live content import or publishing API called.

## Unfinished work
None. Implementation, tests, deployment and read-only production checks are complete.

## Recommended next step
Give the bot the /psychology-video-hits/import URL in its logged-in browser. Import one real album, wait for the read-back success state, and open the returned record before continuing.

## Release evidence
Runtime commit f813a4c271dbd1ad366c8ab4e01e517660eca622 was committed and pushed to GitHub main before npm run deploy, with a clean checkout and exact HEAD == origin/main. Cloudflare version 4298ba91-185b-46f4-a0ea-c971c354754e deployed successfully. All six checked public code/style/guide assets returned 200 and matched local SHA-256. Both the new route and its direct HTML alias redirected unauthenticated users to login (302). No real content or publishing jobs were created during verification.
