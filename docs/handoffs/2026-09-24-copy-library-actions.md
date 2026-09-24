# Copy library action simplification — 2026-09-24

## Goal
Simplify both video/photo copy-library tabs per the user's screenshots.

## Decisions
- Remove bottom recreation jobs board and its polling on the unified page; existing original recreation submission and publishing-records destination remain intact.
- Remove media-move controls from both tabs. The shared legacy page retains its handler with null guards.
- Delete page-export button, serialization and download handler.
- Replace row Copy with New rewrite; separate source-bound creation dialog from rewrite history. Saving locks duplicate submits/source switching and keeps the idempotency suffix on retry.
- Remove folded creation and Grok import from rewrite details. Keep the existing top-right bulk import in its own dialog; it must never inherit a previously inspected source.
- Preserve full-text copy in the read-only preview and Grok integration APIs.

## Files changed
- public/psychology-copy-library.html / .js
- public/psychology-peer-hits.js / psychology-peer-production.js
- scripts/psychology-copy-library-ui.test.js
- factory-cloud/package.json / src/psychology-peer-hits.test.js
- docs/CURRENT_STATE.md

## Validation
- 621/621 factory-cloud tests pass, including five UI regressions: removed controls, both media source bindings, duplicate-submit/retry safety, bulk-import isolation, no hidden jobs polling.
- Browser skill local mock: video and photo show four row actions; New rewrite opens direct editor; sample video rewrite saves successfully to mock API; rewrite details contain only original/history/search and no import/create sections.
- No real publishing or content mutations in browser verification. Console entries seen were browser-extension errors only.
- git diff --check passed. Remote main matched base eb93cb3 before commit.

## Remaining / next step
Ship through the required commit/push/main-clean deployment gate and verify live read-only controls. No DB migration or publishing queue changes.

## Follow-up: compact list columns
- User requested removing 发布文案 and 提取内容 from both media lists. Removed the two header/data cells, changed empty-state colspan to 9, and remapped widths to the nine-column layout (minimum 1210px). Full originals remain accessible through 查看文案; stored data and rewrite detail columns are unchanged.
- Changed public/psychology-copy-library.html, public/psychology-peer-hits.js, public/psychology-copy-library.css, public/admin-ui.css and the existing table assertion in factory-cloud/src/psychology-peer-hits.test.js.
- Validation: syntax check, git diff --check and 621/621 tests pass. Deploy through main gate; no migrations required.
