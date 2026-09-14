# Customer information cleanup release — 2026-09-07

## Goal
Ship customer presentation cleanup together with the existing workspace design improvements.

## Decisions and files
Main application repository D:/cursor/tiktokaitool, commit 94ea05e (includes design base 4d28b69). Detailed file list and decisions are in its docs/handoffs/2026-09-07-customer-information-cleanup.md.
Customer UI uses readable permissions and actionable errors. Customer publishing responses omit batch/provider/storage diagnostics. Historical publishing restrictions are distinguished from current authorization state. Machine IDs required for functionality and server diagnostic records remain.

## Validation
138 tests passed; TypeScript passed; local real-component visual preview inspected. Production read-only browser checks confirmed Chinese capability labels and reduced customer connection/task fields. No live publishing/deletion was triggered.

## Release
Committed and pushed main; clean worktree and HEAD equals origin/main. Deployed using npm run cloudflare:deploy. Cloudflare version 9e915d82-c31f-44e7-ae15-da28e74c82c3. Production tiktokaitool.com confirmed. Browser QA session closed and temporary preview server stopped.

## Unfinished work
None for this release scope.

## Recommended next step
Observe customer feedback on the deployed interface.
