# Psychology video-hit import types — 2026-10-09

## Goal
Label API-imported recreations as video or image/copy and support filtering on the video-hit page.

## Decisions
Reuse durable input_mode: video displays 视频; frames displays 图文 (images/copy later composed into video). Existing imports and cleaned records classify automatically. Source rows show both type counts for mixed inputs; server filtering uses EXISTS before pagination and owner/search/archive scope. Recreation rows/details keep an explicit type badge even after cleanup. Child lists combine type and publication state while preserving numeric version order. Type selection survives refresh/detail navigation. No schema, renderer, publication or cleanup behavior changes.

## Files changed
Video-hit read API and unified catalog; source/recreation/detail HTML/JS/CSS and manifest; API/backend and real Chromium tests; API guide and state/architecture docs. Mobile source summary wraps its action buttons below the title.

## Tests performed
Focused API/browser tests passed 19/19. Covered actual project-key imports, mixed types, empty source, ownership, search/archive combination, invalid mode, pre-pagination filtering, type edits, cleaned records, browser selection/refresh/back-navigation and 1440/390/320 layouts. Screenshots inspected for desktop source list and mobile recreation list. Final full suite passed 1351/1351, no failures/skips. UI manifest and git diff checks passed. Existing video-transfer PID 100756 stayed unchanged. Deployment evidence follows after verification. All test data/storage/publishing use isolated fixtures; no production publication calls.

## Unfinished work
Deployment verification pending. No running workers are restarted.

## Recommended next step
Ship verified code through main using the guarded npm deploy, verify public UI assets read-only, then use the page type selector or videoHits.list params.query.inputMode (all/video/frames).
