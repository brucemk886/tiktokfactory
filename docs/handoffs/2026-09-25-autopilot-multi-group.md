# Multi-group autopilot creation

## Goal
Select multiple groups and start them with one strategy and duration in one user action.

## Decisions
Replace the group dropdown with checkbox cards, select-all/clear and group/account totals. Managed (including paused) and empty groups cannot be selected. Refresh preserves eligible selections and removes unavailable ones. Submit snapshots strategy/duration and sequentially calls the existing scoped create endpoint for each group, retaining independent pilots, statistics and permissions. No backend contract or scheduling algorithm changes.

Creation displays per-group progress and results, continues after an individual failure, blocks duplicate clicks/form changes/modal close while submitting, and removes successful groups from retry selection. Scheduling errors after a successful creation are shown separately. A failed request is marked unconfirmed because the server may already have committed the pilot; refresh reconciles membership before retry. Successful groups remain locally protected even if refresh fails or returns stale data. Keep the page open until all groups finish.

## Files changed
public/psychology-autopilot.html, .js, .css; scripts/psychology-autopilot-ui.test.js; docs/CURRENT_STATE.md.

## Tests performed
Full factory suite: 697 passed. Focused tests cover nine-group creation, excluded groups, frozen strategy/duration, serial requests, duplicate submit and refresh protection, modal escape guard, partial failures, scheduling warnings, escaping and selection refresh. Isolated headless Edge created nine mock groups in one action; desktop/mobile screenshots and no horizontal overflow checked, no browser script errors. No production pilots or publishing jobs created by verification.

## Unfinished / next
Commit and push main, deploy with npm run deploy, read-only production UI verification. No migration.
