# Project and group management

## Goal
Consolidate create, rename and delete for account projects/groups in 项目分组管理.

## Decisions
- Account-page link and management-page title are 项目分组管理 at the existing /tiktok-connections-organize route.
- Move rename dialog and both rename buttons to the management page; project/group dropdowns also drive rename targets and enabled states. Project selection filters groups. Two management rows each have a selector, rename and delete.
- Remove filter/row rename buttons from account lists; retain filtering and moving accounts/groups. Existing APIs, permissions, IDs, associations and delete confirmations unchanged.
- Implemented in isolated checkout to preserve another ongoing autopilot implementation.

## Files changed
public/tiktok-connections.html, tiktok-connections-organize.html, tiktok-connections.js/css; scripts/tiktok-connections-ui.test.js.

## Validation
673 full-suite tests passed, including stable rename IDs/memberships and management/account-page control placement. No production account mutations. Read-only online dialog smoke verification follows deployment.

## Next step
Commit/push main and deploy using the standard guarded command from a clean main checkout. Select existing project/group on the management page to rename or delete.
