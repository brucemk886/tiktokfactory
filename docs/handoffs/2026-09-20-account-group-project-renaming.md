# Goal
Rename TikTok account groups and projects directly from the account page.

# Decisions
- Add 修改分组名称 / 修改项目名称 beside the corresponding filter. All/unassigned choices cannot be renamed. Each group row also offers 修改名称.
- Shared native dialog pre-fills the current name, validates trimmed nonempty names up to 40 characters and duplicates, locks controls while saving, and preserves retryable errors in place.
- Reuse existing admin-only PATCH /api/official-tiktok/account-groups/:id and /projects/:id with {name} only. Stable IDs, moduleKey, project memberships and account assignments remain unchanged.
- Existing state refresh updates dropdowns, group/account labels and retains checked visible rows. No production names changed during implementation or verification.

# Files changed
public/tiktok-connections.html, .js, .css; scripts/tiktok-connections-ui.test.js; docs/CURRENT_STATE.md.

# Tests
- Full factory suite: 504/504 passing. Additional group-service suite passed.
- A regression verifies project/group rename preserves IDs, psychology module scope and account membership through normalization.
- Isolated Chrome: rename both types, prefill, duplicate-name rejection, failed request retry, cancellation, labels and selected rows; desktop and mobile dialogs checked. Mock PATCH requests only.

# Unfinished work
Deployment and live read-only smoke results are reported in the task response.

# Next step
Select a specific group or project on /tiktok-connections, click 修改名称, enter its new name and save.
