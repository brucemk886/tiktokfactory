# Remove account/content pools from data overview — 2026-09-30

## Goal
Delete the account pool × content pool content and logic from psychology data overview.

## Decisions
- Remove the HTML panel, its styling, loader, renderer, retry behavior and descriptive copy. Overview now requests analytics, publishing receipts and profile traffic only.
- Remove the shared overview API pool adapter and import. Supported view values are full, analytics, publish and traffic; removed/unknown values return 400 before report queries.
- Effects management queries/presets no longer accept the pool-only view parameter. Old saved presets containing it return a validation error and can be edited through the existing preset API.
- Project/group permission scoping, project-wide labels, account identity corrections, ordinary metrics, video navigation and profile traffic retain their existing behavior.
- This deletion is scoped to data overview. Operations pool reporting and the automatic matching scheduler keep their current contracts; no active jobs or production configuration were edited.

## Files changed
- public/official-group-report.html, .js and .css
- factory-cloud/src/official.js
- factory-cloud/src/psychology-management-api.js
- scripts/official-report-detail.test.js
- factory-cloud/src/psychology-pool-report.test.js and psychology-management-api.test.js
- factory-cloud/src/ui-asset-manifest.js
- docs/CURRENT_STATE.md, ARCHITECTURE.md, psychology-management-api.md and this handoff.

## Tests performed
- Focused report/UI/management suite: 41 passed.
- Full factory suite: 959 passed, zero failures or skips.
- Regression checks verify absence of pool HTML/styles/renderer/API calls, retained date/group/module scope, retired pool-view rejection before SQL, and rejected effects presets using the removed parameter.
- Isolated headless Chrome with synthetic data: only analytics/publish/traffic requests; 13 normal metric cards and video rows render; project scope remains correct. No page errors or whole-page overflow at 1440px and 390px. Screenshots remain outside Git.
- No live publishing API calls or job/configuration writes in tests.

## Unfinished work
No pending implementation.

## Recommended next step
Refresh data overview to use the standard publication, playback, interaction and profile-traffic metrics. Any saved effects preset containing the removed view parameter should be edited to the documented ordinary report fields.
