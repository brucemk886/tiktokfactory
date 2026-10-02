# Psychology module workspace redesign — 2026-10-02

## Goal
Implement and release the twelve remaining Psychology pages after the user approved the design gallery with “上线吧”. The image-only phase is recorded in `2026-10-02-psychology-module-design-preview.md`.

## Decisions
- Extend the approved blue workspace using per-page `psychology-workspace-page` opt-in styling. Content lists use compact filters/actions; creation tools group real forms beside previews; publishing/comments separate current progress, results and available actions.
- Preserve element identities, role/module permissions, real API data and existing generation/publishing/comment/queue contracts. Operations Report, Data Overview and Automatic Operations retain their separate styles.
- Preserve source versus owned performance, current inventory versus period usage, missing versus zero, image availability versus topic usage, and Beijing versus device-local timestamps. Missing coverage has no fabricated progress indicator.
- Keep redirects and retired manual recreation unchanged. Publication history retains existing actions; production details remain read-only.
- Five small deployed images are explicitly labeled template examples, derived from existing template compositions/renderers. Synthetic operational fixtures, private reference captures and the image-only gallery remain ignored and are not deployed.
- Repair the existing single-image submission defect with the existing uploaded-image/four-choice collectors and fixed character-choice payload. Clear local input-validation errors when input becomes valid, while retaining job/server failures. Both single-image and collage editors now use correct terminal-state fallbacks. No backend, scheduler, provider contract or database migration changes.

## Files changed
- Twelve active page HTML files and their page-specific CSS/JS in public/: copy library, copy usage, topic bank, template hub, four-image, collage, single-image, photo, styles, auto publishing, comments and publication records. Supporting peer-hits and auto-replies clients retain existing behavior.
- New shared scoped `public/psychology-workspace.css`, template-hub stylesheet and five `public/psychology-template-previews/*.png` examples.
- New browser/interaction tests: `psychology-content-layout.test.js`, `psychology-creation-ui.test.js`, `psychology-operations-workspace-ui.test.js`. Existing first-paint, coverage, narrative, module and peer-hit tests now check the correct semantics/boolean attributes/time labels.
- factory-cloud package test registration and generated UI asset manifest; CURRENT_STATE and this handoff. Preview-phase handoff is also preserved.

## Tests performed
- Final `npm test --prefix factory-cloud`: 1,185 passed, 0 failed, 0 skipped. All three new suites are registered in the standard command.
- Actual frontend Chrome fixtures use only localhost mocked APIs; external requests are blocked. No live generation, publishing or comment API calls occur in tests.
- Formal screenshots cover 24 page/operation states across desktop 1440 and mobile 390; topic navigation also passes 320. Images, modal bounds, viewport overflow, keyboard tabs, pagination, permission-hidden controls, local upload summaries, selected-account publication payload, real style rendering and terminal/error states are checked.
- All original static HTML IDs remain in the twelve pages; no duplicates or missing script/style references. Only these twelve pages opt in to the new workspace; existing reports/overview/autopilot assets are untouched.
- Tracked UI manifest regenerated after the final source changes. Synthetic QA and private references stay under ignored tmp/psychology-module-design-20261002/.

## Unfinished work
Commit/push the validated change to GitHub main, deploy from a clean exact-main checkout with factory-cloud npm run deploy, then record the deployment version and read-only production verification.

## Recommended next step
Complete the authorized release and verify the twelve hosted routes without starting or interrupting generation/publishing jobs.