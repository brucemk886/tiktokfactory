# Psychology video-hit import types — 2026-10-09

## Goal
Label API-imported recreations as video or image/copy and support filtering on the video-hit page.

## Decisions
Reuse durable input_mode: video displays 视频; frames displays 图文 (images/copy later composed into video). Existing imports and cleaned records classify automatically. Source rows show both type counts for mixed inputs; server filtering uses EXISTS before pagination and owner/search/archive scope. Recreation rows/details keep an explicit type badge even after cleanup. Child lists combine type and publication state while preserving numeric version order. Type selection survives refresh/detail navigation. No schema, renderer, publication or cleanup behavior changes.

## Files changed
Video-hit read API and unified catalog; source/recreation/detail HTML/JS/CSS and manifest; API/backend and real Chromium tests; API guide and state/architecture docs. Mobile source summary wraps its action buttons below the title.

## Tests performed
Focused API/browser tests passed 19/19. Covered actual project-key imports, mixed types, empty source, ownership, search/archive combination, invalid mode, pre-pagination filtering, type edits, cleaned records, browser selection/refresh/back-navigation and 1440/390/320 layouts. Screenshots inspected for desktop source list and mobile recreation list. Final full suite passed 1351/1351, no failures/skips. UI manifest and git diff checks passed. Existing video-transfer PID 100756 stayed unchanged. Commit 11ad51c1ed1d493dd5aeeeda400560fde3f3958d was pushed to main and deployed using npm run deploy from a clean exact HEAD == origin/main release. Production version eb2a2e81-dd43-40e8-b488-4a14f6a73395. Live JS/CSS hashes matched; unauthenticated video/frames filtered reads and private video reads returned 401. All test data/storage/publishing use isolated fixtures; no production publication calls.

## Unfinished work
Implementation, testing and deployment verification are complete. No running workers were restarted.

## Recommended next step
Use the page type selector or videoHits.list params.query.inputMode (all/video/frames); existing imports need no reimport or migration.
