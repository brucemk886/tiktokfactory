# Psychology queue account handles — 2026-09-19

## Goal
Show TikTok @usernames on psychology automatic publishing batch cards, including historical photo batches.

## Cause and decisions
Account and batch requests run concurrently. When batch data arrived first, the queue rendered internal connection IDs and did not rerender when accounts arrived. Labels also preferred display names over usernames.
Separate queue rendering from fetching and rerender after account refresh. Prefer normalized @username, fall back to nickname, then readable loading/unavailable text. Deduplicate by connection ID so separate accounts remain separate. Publishing IDs, schedules and jobs are unchanged.

## Files changed
- public/psychology-auto-publish.js
- scripts/psychology-auto-publish-ui.test.js
- factory-cloud/package.json

## Tests performed
Three behavioral UI tests pass: delayed account response, immediate username refresh, missing-account fallback and HTML escaping. JavaScript syntax check passes.

## Unfinished work / next step
Release through the repository deploy script and check the historical 0918-测试-3 card read-only. No job retry or posting is needed.
