# Psychology member grants — 2026-10-09

## Goal
Allow administrators to select every psychology feature for member accounts. The old role catalog hid all but three entries and domain APIs still required administrators.

## Decisions
- All 17 psychology catalog entries are eligible for explicit member grants; existing stored grants/roles are not migrated.
- Member session normalization no longer auto-adds psychology reporting, publishing or sibling modules. Every selected entry survives save/reload, including standalone child templates.
- Domain APIs and fresh background authorization accept active members with the corresponding grant. Existing owner checks, official-account group scopes and source/asset ownership remain enforced.
- Website and visual styles have independent member grants. Copy-source and production legacy aliases retain their existing merged-page behavior.
- Automatic operations that activate publishing require both psychology-autopilot and psychology-publish; revoked autopilot authorization also stops future planning at the execution gate.
- Shared credentials and account administration remain admin-only. Template UI preferences are saved per member, and the photo template can use its image-generation/upload dependencies without enabling chat/video AI.
- Project REST/MCP credentials and legacy key admission remain unchanged. No live member grants, publishing jobs, importing jobs, or paused planning configuration were changed.

## Files changed
Hosted sidebar/auth, shared psychology permission predicate, psychology API/background gates, template/photo dependencies, accounts/access UI, focused permission/browser tests and prior admin-only test expectations. CURRENT_STATE and ARCHITECTURE describe the grant boundary.

## Tests performed
- SQLite integration tests cover save/reload/revoke, individual module APIs, no-grant denial, administrator-only credentials, account scope, fresh queued-publish authorization, personal settings and generation admission.
- Real headless Chrome verifies all 17 member checkboxes, select-all/single selection, actual admin PATCH persistence/reload and child-only sidebar navigation. Screenshots inspected at desktop and mobile widths under tmp/psychology-member-qa (not committed).
- Focused suite: 65 tests passed. Full suite passed 1408/1408 before integration; after rebasing the latest video picker, direct One assignment and schedule-feedback changes, the combined main suite passed 1417/1417 with four test workers.
- All network providers in tests are fixtures; no live publishing calls.

## Unfinished work
Implementation, latest-main integration, regression verification and production deployment are complete. No remaining implementation work.

## Recommended next step
After release, refresh Account Management, edit a member, select psychology features and account groups, then save. Do not automatically grant features to existing members.

## Release evidence
Runtime commit 945a865 was pushed to GitHub main, then deployed with npm run deploy from factory-cloud after the guard verified a clean worktree and exact HEAD == origin/main. No schema migrations were pending. Cloudflare version 75bbf842-468b-4fe8-8fcd-2c95806a16ad deployed successfully with all existing cron/queue/workflow bindings. Live accounts.js, access.js and the retained psychology-auto-publish.js each returned HTTP 200 and matched the released files. Production account grants were not modified during verification.
