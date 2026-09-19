# Official publish record hover details — 2026-09-19

## Goal
Replace unreliable native title hints with immediate full-text hover details for file/title, local task, batch and notes.

## Decisions and files
- public/official-publish-records.js: one body-level tooltip using textContent, delegated whole-cell hover, focus and click; delayed dismissal permits moving into the popup to scroll/select. Escape, outside click, table/page scroll, resize and refresh dismiss it.
- public/official-publish-records.css: wrapped, scrollable fixed overlay positioned within the viewport, outside table clipping.
- scripts/official-publish-records-tooltip.test.mjs: mocked browser regression with no real publishing calls. CHROME_PATH can override the default local Chrome path.

## Validation
All four cells tested with actual Puppeteer hover; complete escaped text, viewport placement, pointer transfer, popup scrolling, focus/Escape, refresh dismissal, compact rows and retained links passed. Screenshot visually reviewed. Official publishing record tests: 10 passed. JavaScript syntax/diff checks passed.

## Remaining work
No publishing workflow changes or retries were made. Missing/expired cached photo recovery remains separate as documented in the previous handoff.

## Next step
Commit/push main and deploy via factory-cloud npm run deploy.
