# Ready-photo publishing defaults

## Goal
Default the AI declaration to unchecked, derive publication quantity from selected albums, and fix the empty optional-settings expander in Psychology manual photo creation.

## Decisions
- Selected Video Hits albums start with isAiGenerated=false; explicit checking still sends true and survives selection/configuration updates. Existing jobs and saved automatic settings are untouched.
- Hide and disable the quantity field for selected albums. Summary, validation, confirmation and new request count read photoPicker.refs().length directly, so stale field values cannot affect publication. Generated sources retain the quantity control. Existing server count/ref validation remains.
- The empty expander was caused by moving music outside while hiding the ready-album style/rewrite controls. Hide the whole expander for selected albums; generated-photo style options and the standalone music picker remain available.

## Files changed
- public/psychology-auto-publish.html/js and generated UI asset manifest.
- Existing ready-gallery and selected-video/photo browser regression scripts.
- CURRENT_STATE and this handoff.

## Tests performed
- 65 focused backend, UI and manifest tests passed.
- Full mocked Chromium selected-video/photo flow passed. Verified default false and manual true AI payloads, selected count despite a stale hidden quantity of 99, cross-page selection, source-mode switching, visible generated-photo style controls, and unchanged receiver/music fields.
- Inspected the 1440px desktop screenshot in tmp/photo-publish-defaults-qa/hit-photo-selection-end.png: checkbox unchecked, quantity field and empty expander absent. No new mobile acceptance added; existing test coverage retained.
- No real publication or settings writes used for verification.

## Unfinished work
None.

## Recommended next step
Refresh the photo creation page, select the desired albums, and create the task. The selected-card count is the publication count.

## Release evidence
Runtime d0af88927a3a11989289b035dc429468a6f5845f was committed and pushed to GitHub main before deployment from a clean exact HEAD == origin/main checkout using npm run deploy. Worker version d14e4131-cdd4-4526-bee1-4513953e01e3. Production publishing JS returned HTTP 200, matched the committed normalized SHA-256, and contained the selected-ref count logic. No existing jobs or settings were modified.
