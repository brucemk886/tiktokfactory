# Account pool card drilldown — 2026-09-30

## Goal
Let operators click any account pool card in the psychology operations overview to inspect the corresponding accounts.

## Decisions
- Account cards are native buttons with a visible 查看账号 action, accessible labels and focus indication. Content cards retain their existing display.
- Clicking a card switches to the existing account panel, selects that account pool and starts on page one. Period/custom dates, group and photo/video scope are preserved.
- Existing scoped reporting APIs, pagination, empty/error handling and request cancellation are reused. No classification rules or automatic publishing configuration changed.
- Card explanation text wraps inside the button on desktop and mobile.

## Files changed
- public/psychology-operations.js
- public/psychology-operations.css
- scripts/psychology-operations.test.js
- factory-cloud/src/ui-asset-manifest.js
- This handoff.

## Tests performed
- Full factory suite: 952 passed, no failures or skips.
- Focused operations/asset suite after final CSS adjustment: 30 passed.
- Two new interaction tests cover native buttons, zero-count pools, nested clicks, preserved custom dates/group/video, page reset, tab/URL/focus, invalid targets and stale responses.
- Isolated headless Chrome with synthetic API data verifies all six pool cards, Enter activation, matching requests and account rows, no page errors or card text overflow, and 390px mobile layout without whole-page overflow. Screenshots and temporary QA scripts are outside Git.
- No live publishing APIs or operational configuration writes in tests.

## Unfinished work
No pending implementation.

## Recommended next step
Refresh the operations report and click an account pool card to inspect account identity, group, mature work counts, playback performance, recovery judgment and matching recommendations under the current scope.
