# Admin console first-paint fix

## Goal
Stop authenticated pages briefly showing the previous beige/green theme before switching to the navy console.

## Cause / decisions
The HTML only contained legacy styles. access.js dynamically fetched the console CSS/JS, and admin-ui.js added the enabling body class only after /api/auth/me completed. The old theme helper also appended a duplicate theme-ops stylesheet.

All 50 authenticated sidebar pages now include the console class in their initial body and render-block on admin-ui.css in head. admin-ui.js loads with defer in parallel. Preserve the former effective stylesheet cascade: page styles, theme-ops, admin-ui. Auth-dependent navigation and role visibility still wait for the verified user. Public login/setup stay unchanged. Legacy fallback reuses an existing theme and inserts any missing base theme before the console stylesheet.

## Files changed
50 public/*.html console documents; public/access.js; scripts/admin-ui-first-paint.test.js; factory-cloud/package.json; docs/CURRENT_STATE.md.

## Tests performed
616/616 factory-cloud tests pass, including checks that all console pages enable the new render-blocking theme from their initial document, preserve cascade order, avoid duplicate base-theme insertion, and exclude public auth pages.
A local mock delayed /api/auth/me by 30 seconds. While sidebarReady was false, the browser reported body rgb(245,247,251), sidebar rgb(25,43,67), main left 224px and exactly one base-theme stylesheet. The former implementation showed beige during this interval. Browser debug capture was unavailable due CLI/extension protocol mismatch; screenshot capture was interrupted by tab visibility. The verification used actual computed browser styles and initial HTML, not a claimed screenshot capture.
No live publishing, queue or permission behavior changed.

## Release / next step
Commit and push main; deploy with factory-cloud npm run deploy. Verify live initial HTML and computed theme read-only. No known unfinished implementation work.
