# Explicit project-list join selection — 2026-10-08

## Goal
Make bulk project joining understandable directly in the project account list, and ensure one account failure does not stop the other accounts.

## Decisions
- Add a labelled checkbox on each project account row, a select-all checkbox with partial-selection state, and a bulk button showing the selected count.
- Preserve one-click bulk behavior: checked, unconfirmed accounts default selected. Confirmed members have an unchecked disabled box and are skipped. Operators can deselect accounts to join a subset.
- Join choices are scoped to brand/account/project and do not alter the upper publishing-account selection. Active checks/joins lock the controls, and project changes reset visible controls correctly.
- Preserve sequential per-account try/catch: a failure remains visible and processing proceeds to the next account. No automatic reattempt within the batch; already successful accounts are not rejoined. Individual retry and confirmation remain.

## Files changed
public/psychology-tiktok-one.js, public/psychology-auto-publish.html, public/psychology-auto-publish.css, scripts/psychology-selected-ui.test.mjs, scripts/psychology-one-check-ui.test.js, generated UI asset manifest and current state.

## Validation
- Isolated desktop/mobile browser regression passed: visible checked boxes, subset selection, master select/clear, cancelled confirmation, first account fails while next succeeds, individual retry, confirmed-account exclusion, project isolation and no publication on join.
- Existing concurrency/timeout/cancellation unit tests passed.
- Full factory suite: 1,297 passed. No real TikTok/GeeLark joining or publication called by tests.
- git diff --check passed.

## Unfinished work / next step
Commit and push main, then deploy using npm run deploy with a clean exact origin/main match. Refresh the factory page to show the new controls. No live account join or video publication is part of this implementation.
