# Goal
Show account totals beside every group on the TikTok authorized-account management pages.

# Decisions
- Group filter, account move target, group move selector and management group selector share the same `项目 / 分组（N 个账号）` labels.
- All-groups and ungrouped options include totals; empty groups show 0.
- Counts use the complete loaded account directory before search and pagination, matching the accounts available on this page. Existing incomplete-directory warnings remain in place.
- Do not fall back to historical assignment counts when the current count is zero.
- A returned full assignment map is authoritative. Moving an account back to ungrouped now clears the old membership immediately and refreshes all labels; responses without an assignment map preserve current membership.
- Original checkout changes were left untouched; implementation uses an isolated managed worktree and deployment uses an independent clean main checkout.

# Files changed
- public/tiktok-connections.js
- scripts/tiktok-connections-ui.test.js
- factory-cloud/src/ui-asset-manifest.js
- This handoff

# Tests performed
- 13 focused UI and asset regression checks passed.
- Isolated Chrome with mocked APIs at 1440px and 390px: full directory counts, empty groups, move-to-group and move-to-ungrouped updates passed. No production accounts were moved.
- Asset manifest regenerated; git diff --check passed.

# Unfinished work
- None. Runtime b5799fd was pushed to GitHub main before deployment from a clean checkout with exact HEAD == origin/main.
- npm run deploy released Worker 1ff262aa-9cae-458f-8558-d87509ccb40a. No migrations were pending. The first attempt hit a transient Cloudflare network error; retry succeeded.
- Live tiktok-connections.js returned HTTP 200 and its SHA-256 matched the committed source: 1f79d9d2e0d27a290e048c4bc9e90626db3bdbef0263fa76df8cfa214a2a5e23.

# Recommended next step
Refresh /tiktok-connections and open the group filter or move-target selector to see each group's current account count.
