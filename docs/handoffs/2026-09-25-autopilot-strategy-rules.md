# Autopilot strategy rule display

## Goal
Explain the relationship between the selected operating strategy and common operating rules in the new autopilot dialog.

## Decisions
Return strategy descriptions with actual EVOLUTION thresholds from the backend. Show the selected strategy immediately on change, with common scheduling, source selection, deduplication and pause rules separately expanded below. A uses probabilistic version selection, not fixed batch quotas. C prefers least-used rewrites and may fall back to an available original. Account history and version availability mean paired source ordering does not guarantee identical final sources across groups. This change does not alter selection, scheduling or existing pilots.

## Files changed
factory-cloud/src/psychology-autopilot.js and its tests; public/psychology-autopilot.html, .js, .css; scripts/psychology-autopilot-ui.test.js.

## Tests performed
Full factory-cloud npm test: 687 passed initially; 692 passed after integrating the latest origin/main copy-library update. Focused UI tests verify immediate A/B/C switching, no request on strategy change, escaped rule text, preserved selection after refresh and unchanged common rules. Isolated headless Edge checks verified all three descriptions and captured the A/C dialogs; A screenshot visually reviewed. No real publishing or pilot changes used for verification.

## Unfinished work / next step
No implementation work remaining. Commit and push main, deploy with npm run deploy, then verify production assets and read-only rule metadata. No migration required.
