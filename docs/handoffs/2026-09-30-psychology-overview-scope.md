# Psychology overview account scope — 2026-09-30

## Goal
Restrict psychology data overview to psychology project accounts and present accurate unique account counts.

## Decisions
- Production psychology assignments contained 376 identity entries: 188 connection IDs plus 188 alternate identities. These are 188 unique project accounts, not 376 separate accounts.
- Shared read-only SQL resolves saved aliases and legacy profile/label identities before counting or joining report facts. A direct current primary assignment determines the group. Stale aliases cannot restore a moved/deleted primary grant; ambiguous identities are excluded.
- Unsynced assigned primary accounts remain counted. The publishing directory currently exposes 187 available entries while the project has 188 assigned identities; report counts are not limited by directory availability.
- Pool overview/account details and other operations panels share the canonical report scope. Runtime matching and active publishing configuration are unchanged.
- Overview analytics, publishing receipts and profile traffic intersect the user's allowed groups with the selected module project, including users authorized for multiple projects.
- Psychology UI labels are 心理学项目账号 / 心理学分组账号 and 心理学全部分组, with a clear project/permission/unique-identity explanation. Other report path labels are preserved.

## Files changed
- factory-cloud/src/official-report-account-scope.js (new shared report SQL)
- factory-cloud/src/psychology-pool-report.js and psychology-pool-report.test.js
- factory-cloud/src/psychology-report-query.js
- factory-cloud/src/official.js and profile-traffic.test.js
- public/official-group-report.js and scripts/official-report-detail.test.js
- factory-cloud/src/ui-asset-manifest.js
- docs/CURRENT_STATE.md, docs/ARCHITECTURE.md and this handoff.

## Tests performed
- Full factory suite: 960 passed, zero failures or skips.
- New SQLite-backed regressions cover UUID/username deduplication, profile/label fallback, unsynced and unmapped direct identities, moved/removed/revoked primary grants, other-project facts, and no remote/report writes.
- Mixed-project operator and admin tests verify traffic, analytics, receipts and full reports; invalid groups and empty/revoked scopes never read another project. Original scope reproduced two new regression failures.
- UI tests cover path/module spoof resistance, project-wide and selected-group labels/links, and preserved other module labels.
- Isolated headless Chrome with synthetic data: project and group labels/selection verified, no page errors, no whole-page horizontal overflow at 1440px or 390px. Screenshots remain outside Git.
- Production read-only canonical scope query: 188 unique psychology accounts in 11 groups; zero rows written. No publishing tasks/configuration changed.

## Unfinished work
No pending implementation.

## Recommended next step
Refresh psychology data overview and verify the project-wide card and selected-group counts. Today's samples remain under observation until the existing 72-hour maturity gate; account deduplication does not change that policy.
