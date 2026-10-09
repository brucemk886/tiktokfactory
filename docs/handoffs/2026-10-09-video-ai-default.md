# Video publication AI flag default

## Goal
Remove the default AI-generated checkbox from new Psychology video publishing tasks.

## Decisions
- The One selected-video and normal Video Hits video forms both had checked HTML defaults. The selected-video assignment helper also defaulted to true.
- Both video checkboxes and the helper now default to false. Explicit manual true/false values remain unchanged through frozen payloads, retries and hub submission.
- This applies to future video submissions. Existing queued/submitted/published records, photo controls and independent recreation disclosure selectors are unchanged.
- No database migration or production publishing request is required.

## Files changed
- public/psychology-auto-publish.html
- public/psychology-video-picker.js
- factory-cloud/src/ui-asset-manifest.js
- factory-cloud/src/psychology-video-library.test.js
- scripts/psychology-video-assignment.test.js
- scripts/psychology-selected-ui.test.mjs
- docs/CURRENT_STATE.md and this handoff

## Tests performed
- Publishing library, assignment and UI tests: 49 passed.
- UI asset manifest tests: 7 passed; manifest regenerated.
- Real Chromium localhost fixture passed on desktop/mobile: unchecked One and normal defaults, false submission, explicit true selection, corrected schedule and frozen retries, bulk selection preserving the chosen flag. All external requests blocked; no real publishing APIs called.
- Updated the existing bulk-selection assertion to preserve manually checked true under the new default.
- git diff --check passed.

## Unfinished work
None. Implementation, validation, deployment and live asset verification complete.

## Release verification
- Runtime commit 62621d8 was pushed to GitHub main before the guarded npm run deploy; worktree was clean and HEAD equaled origin/main.
- Cloudflare version c1fc4d28-4179-4a57-a3d7-ba0756d950ed; both updated HTML and picker assets uploaded successfully.
- Live psychology-video-picker.js returned HTTP 200, matched the local SHA-256 and contained the false default.

## Recommended next step
Refresh the new publishing form; choose the AI flag explicitly when appropriate for the selected videos.
