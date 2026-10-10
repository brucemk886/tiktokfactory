# Remove duplicate selected-photo display

## Goal
Remove the user-highlighted 已选图文与发布文案 block from Psychology manual photo creation.

## Decisions
- Remove the duplicate heading/list, list-only removal handler and unused list styles.
- Keep original card previews, captions, ordered image expansion, checkboxes, selected count and cross-page ordered selections. Uncheck a card or use the existing clear-page button to remove selections. Publication inputs, saved captions, receivers and music settings are unchanged.
- Desktop acceptance per current Factory preference. No publishing jobs or settings are touched.

## Files changed
- public/psychology-auto-publish.html, psychology-hit-photo-picker.js, psychology-publish-create.css.
- Existing selected-photo and ready-gallery browser regression scripts and generated asset manifest.
- CURRENT_STATE and this handoff.

## Tests performed
- 38 focused UI/asset checks passed: ready-gallery deep links still preselect exact versions, receiver and music options remain valid, and obsolete selected-list DOM is absent.
- Full mocked selected-video/photo Chromium flow passed: card toggle, count, page select/clear, cross-page preservation, ordered previews and exact submission refs remain correct. Inspected the 1440px desktop screenshot at tmp/photo-selection-display-qa/hit-photo-selection-end.png: pagination now leads directly to the AI declaration and task fields. No real publishing endpoints called.

## Unfinished work
None.

## Recommended next step
Refresh Psychology automatic publishing → photo creation. Review/select through the top cards; the duplicated list below pagination is removed.

## Release evidence
Runtime 981d883f8e4c64948de236c024d37f17c9e1474b was pushed to GitHub main before deployment from a clean exact HEAD == origin/main checkout through npm run deploy. Worker version 856ae260-cb5c-403d-b34b-99fc22f8385c. Production picker script and stylesheet returned HTTP 200, matched normalized committed SHA-256 hashes, and contained no obsolete selected-list references. Existing publishing jobs were not modified or interrupted.
