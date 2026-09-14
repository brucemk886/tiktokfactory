# Scoped factory sync implementation — 2026-09-07

Goal: Restrict factory analytics transfers to explicit business assignments; update videos younger than 24 hours every two hours, older videos daily.

Implementation is committed and pushed on codex/scoped-factory-sync in both repositories:
- Desk: c974161 in D:/cursor/localfactory/work/scoped-desk (GitHub brucemk886/tiktokaitool).
- Factory: a36e607 in D:/cursor/localfactory/work/scoped-factory (GitHub brucemk886/tiktokfactory).

See each worktree docs/handoffs/2026-09-07-scoped-factory-sync.md for decisions and files. Factory scope is authoritative, empty/failed scope cannot send all accounts, receiver and pull ingestion filter scope, existing unrelated archive records are hidden in scoped reads rather than destructively deleted. Pre-assignment discovery only returns permitted owner identities. Desk keeps daily full sync and adds two-hour rolling-24-hour video refresh, preserving older data in conditional R2 merges. Local copies refresh every two hours without changing daily history granularity.

Tests: desk build/tsc and 92-test run passed, followed by six focused tests including the newly added actual R2 writer test (93 tests now in suite); factory 224 tests passed. No real TikTok or publishing calls were used for tests.

Unfinished: Not deployed, not merged into main, local server not restarted. Main workspaces have other uncommitted work, including overlapping desk authentication/publishing changes. Integrate the isolated commits after that work settles; do not replace its files or stage it with this task. Factory must deploy first (scope endpoint), then desk. Deployment must satisfy clean main == origin/main and prescribed npm scripts. Restart local server only when safe for active jobs. API requests still use batch video lists, so older videos may be present in responses even though only recent metrics are persisted in two-hour runs.

Recommended next step: Reconcile with other current main changes, test integration, then release factory before desk. Verify production membership scope before claiming live behavior.
