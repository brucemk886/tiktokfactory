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

## Release outcome
User explicitly requested deployment. Committed/pushed runtime `2a98fca` to main and deployed with factory-cloud `npm run deploy` after the clean HEAD == origin/main guard. No migrations were pending. Cloudflare version: `9fbe5054-0b16-4355-816b-f8a0cf2b9db0`.

Live authenticated browser confirmed `/psychology-templates`, all three template cards and the single workbench sidebar entry. Workbench active state was confirmed. Native live card-click verification was limited by the tiny agent browser viewport (no visible geometry); local actual-browser card/navigation checks already passed. Browser sessions were closed. No production generation or publishing jobs were started.

Release checkout remains `D:/cursor/localfactory/work/psychology-directory-release`. Original checkout and running workers were preserved.
