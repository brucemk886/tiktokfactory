# Psychology template workbench

## Goal
Replace the three psychology template sidebar links with one 模板工作台, matching the mid-video landing page.

## Decisions and files
- Added `public/psychology-templates.html`, reusing app/hub/theme styles and showing three cards to existing template URLs.
- Cloud sidebar `psychology` now points to the workbench. Collage/narrative remain independent permission modules but carry `navigationParent` and are not repeated in navigation. `/psychology` remains the four-image editor and retains its permission alias. Added the workbench page mapping.
- Shared access.js keeps the workbench selected for all three child pages, hides unauthorized cards and routes the psychology business card via the actual sidebar catalog. hub.js handles both auth/HTML load orders; local factory's old catalog still links to its existing page.
- Updated psychology module tests to check route permissions and single navigation entry. No generation, API-key, data or publishing changes.

## Verification
261 factory tests passed. Local actual-browser test `work/check-psychology-workbench.mjs` passed: one workbench link, three admin cards, clicking every card reaches the right template, child-page active navigation, homepage entry, and operator sees only the authorized four-image card. Screenshot inspected; syntax/diff checks passed. All APIs mocked, no real generation/publishing.

## Status / next step
Implemented in `D:/cursor/localfactory/work/psychology-directory-release`, uncommitted and not deployed. Current production remains runtime commit 270716a / Cloudflare version 2d3ad1c2-9739-46e9-8c29-be4115c750b7; remote main 951c168 also includes release documentation. On the next deployment instruction, commit/push main, verify clean HEAD == origin/main, use factory-cloud `npm run deploy`, and check the workbench live. Preserve the dirty original checkout and active worker jobs.
