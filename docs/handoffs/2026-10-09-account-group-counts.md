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
- Commit/push and clean-main production deployment to follow; release receipt recorded in the task response.

# Recommended next step
Refresh /tiktok-connections and open the group filter or move-target selector to see each group's current account count.
