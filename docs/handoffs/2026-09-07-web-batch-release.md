# Web batch publishing release — 2026-09-07

## Goal and decisions
Implemented the requested account-first web flow in sibling tiktokaitool: select up to 50 accounts, upload videos, assign sequentially or randomly without replacement, confirm and submit. Every uploaded asset claims exactly one task. Customer history remains owner-scoped. Resumable multipart uploads and stable chunk receipts protect refresh and retry.

## Files changed
Main implementation and detailed handoff are committed in D:/cursor/tiktokaitool, commit 9cc3006, docs/handoffs/2026-09-07-web-batch-publishing.md. No local factory production code changed.

## Tests and release
133 tests passed, TypeScript and focused ESLint passed. SQLite tests cover 150 tasks across 50 accounts, ownership, transaction rollback and retry. Local browser mock verified six uploads, random 3+3 allocation, refresh recovery and six unique submitted tasks. Media metadata was mocked in that QA page; no real TikTok publishing or sustained 7.5 GB load test was performed.
Fetched origin before release, committed and pushed main. Official npm run cloudflare:deploy passed, including migration 0035 and clean exact origin/main check.
Version: ff88ecb5-1a9d-4b02-9af0-c04d6c0bf147.
Read-only production checks: homepage 200, anonymous batch POST 401. Final worktree clean and HEAD matches origin/main.

## Unfinished work / next step
No requested implementation remains. Validate an initial small real customer batch before sustained large uploads. Uploading requires the browser to remain open; after task acceptance server queues continue independently. Full operational limitations are in the main-repository handoff.
