# Goal
Twenty photo styles, varied covers, stable group/account assignment, batch-reviewed Grokbot copy imports and cross-account copy/style performance.

# Decisions
- User approved group pools + stable per-account assignment + individual override, and offline batch rewriting/import instead of automatic per-generation AI rewriting.
- Twenty stable style IDs use shared Canvas rendering in local/cloud paths. New UI defaults group binding; old payloads preserve legacy rendering. Preview thumbnails are downsampled.
- Migration 0042 owns administrator-scoped bindings/copy variants and immutable per-item creative snapshots. Text-only JSON import is idempotent, revisions require new IDs. No Grokbot credentials or external writes used.
- Imported plans skip TikHub, image extraction and AI rewriting. Original source cache can be exported fifty at a time. Existing peer extraction and optional rewrite remain available.
- Performance uses exact task/account/video joins, final copy fingerprints and explicit source grouping. Unavailable metrics remain null, old styles unknown, mature-only comparison default. Existing report bounds/coverage are visible.

# Files
See docs/psychology-photo-creative.md. New creative handler/migration/tests, shared visual styles/styled renderer, creative management and content-performance UI; modified automatic publishing/workflow/renderers, operations API/UI and page permissions.

# Tests
549 factory tests passed; new coverage for owner scoping, immutable/idempotent imports, invalid binding rejection, stable frozen assignment, no-provider imported workflow, exact task/account metric joins, missing/null metrics and report SQL. Production module loader rendered 40 cover/content images plus 20 long-copy images in local headless Chromium. Contact sheet: work/creative-style-contact-sheet.png (ignored runtime artifact).

# Deployment and next step
Feature commit dbb57b8 was pushed to main and deployed through npm run deploy; version 5e9673c9-03a6-4057-b301-e71f32a96da1. Hosted checks confirmed all twenty previews, authorized group/account assignments, copy-library empty state, automatic-publish photo controls, historical content joins and per-account interaction/watch metrics. Browser sessions closed. No live publishing jobs, account bindings or content imports were created during testing. Operators choose pools and import reviewed copies for future batches.

## Sidebar entry follow-up
User requested a visible psychology sidebar link. Added 图文样式与文案 immediately after 心理学自动发布; existing administrator sessions inherit the link through publishing access without a database rewrite. Operator access remains excluded. Changed sidebar.js/auth.js and extended existing session-permission regression assertions.
