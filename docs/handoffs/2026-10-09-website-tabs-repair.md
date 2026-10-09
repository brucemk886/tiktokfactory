# Independent website tab display repair

## Goal
Repair the misleading tab switching and cramped white navigation blocks on Independent Website.

## Decisions
- Root cause: moving navigation above the analytics page left the funnel, metrics and revenue outside the overview panel. Other report tabs changed only below these large common sections. Global button styling also overrode the transparent tab background.
- Move all overview-only sections and metric definitions into the overview panel. Sources, orders, links and receiving now each show only their own panel; report date controls remain shared across report tabs, including link statistics.
- Use a compact white rounded segmented navigation with padded tabs and a solid blue selected state; scoped styles win over shared button rules. Mobile navigation scrolls within the tab row and does not widen the page.
- Add connected tab/tab-panel ARIA semantics, a single tab stop, arrow/Home/End navigation, and preserve query-string deep links. Preserve analytics loading, refresh/error handling, all settings drafts and save behavior.

## Files changed
- public/psychology-website.html/js/css; remove the old wrap override from psychology-website-receiving.css.
- scripts/psychology-website-ui.test.js; generated UI manifest; CURRENT_STATE and this handoff.

## Tests performed
- Real Chromium with the full admin styling/scripts, at 1366/390/320 px: all five tabs, only the active panel visible, overview funnel absent from other tabs, first content immediately below controls, active style/padding, page overflow, keyboard navigation and direct orders URL.
- Existing safe-text rendering, report filters/pagination, links and delayed/failed responses remain covered.
- Receiving-tab browser tests retain separate-save/draft preservation and analytics-outage behavior.
- Desktop and mobile screenshots inspected at tmp/website-tabs-qa (ignored).

## Unfinished work
None. No backend or publishing changes.

## Recommended next step
Refresh Independent Website and switch between all five tabs.

## Release evidence
All 11 focused browser/asset checks passed. Runtime commit 1f2bf781c9a3865d09cb4b8bb2875a367a1d3265 was committed and pushed to GitHub main before npm run deploy from a clean worktree with HEAD == origin/main. Worker 3ee1605c-b51f-4e9b-bdc2-d40d8e0628b1 deployed. Live website JS/CSS and receiving CSS returned HTTP 200 with SHA-256 matching the tested files. No production settings or publishing tasks were modified.
