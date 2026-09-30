# Psychology project-bound automatic account roles — 2026-09-30

## Goal
Replace manual operating-plan selection with a psychology-project binding. The system admits current and future eligible project accounts and automatically assigns operating roles from account evidence.

## Decisions
- Project-bound enrollment is explicit and revision guarded. It includes previously excluded project accounts, while respecting current publishing authorization and administrator grants.
- Existing administrative assignments do not change. Compatible delivery plans are discovered automatically; missing execution plans use three daily rounds. Roles remain review, production, rescue, diagnosis, observation and launch.
- Seven-day cycles, three-day reviews, the October 2–9 window, account/content matching rules and daily three-round claims remain. Existing frozen jobs and pauses are preserved.
- Newly admitted accounts start at a future safe boundary. Previous exclusions must never become eligible for supplemental batches in the old pre-cycle schedule. Ended plans may retain frozen future publications, so their affected accounts wait until those reserved dates pass before a new executor starts. Other project accounts continue.
- The latest explicit account state is inherited across executor changes, including ended plans; a later explicit resume supersedes an older pause.
- No indefinite cycle renewal or data-overview pool panel is introduced.

## Files changed
- Migration 0071; task-group service, executor bridge and autopilot state inheritance.
- Project-bound configuration UI and focused service/integration/UI tests.
- Asset manifest, architecture and current-state documentation.

## Validation / rollout
Full factory regression suite: 1009/1009 passed. Focused service + execution integration: 35/35; UI: 29/29. Asset manifest and git diff checks passed. Tests use local SQLite and mocked network/workflow calls; no real publishing API calls. Cross-group and cross-owner legacy reservations are covered, including preservation of the planned review cohort during the October 1 legacy / October 2 project transition. Code release 94ddd13 was committed and pushed to GitHub main, then deployed through npm run deploy from a clean checkout exactly matching origin/main. Migration 0071 succeeded. The first Worker upload hit a transient fetch/connectivity failure; repeating the standard deployment succeeded. Worker version: e86980d4-d870-4d8c-8c0a-9b709cad8aa0.

Pre-change live read: 187 eligible psychology publishing accounts, 175 enrolled, 12 excluded; nine plans, 180 historical account rows and 108 listed reserved slots. The stable projection of plan ID/group/status/end, current and pending schedules/strategies, account statuses and slot/batch references hashed to d117b731cc0e6674cdc973c917f7f196351313a639b16e387849afa7149db12b (SHA-256). Policy revision 1 covers October 2–9 Beijing, review October 5.

## Live activation
Authenticated UI preview and save succeeded: policy revision 2, enrollmentMode project, projectId proj-psych, enabled, admitNewAccounts true, reviewTarget 60. Effective October 2 00:00 through October 9 00:00 Beijing; next review October 5. All 187 eligible publishing accounts are enrolled, excluded 0, blocked 0, paused 0. Roles: review 60, strong 0, normal 56, hook rescue 10, content rescue 32, diagnostic 21, observing 1, launch 7. The previously excluded 12 accounts became five diagnostic and seven launch members.

The post-save execution projection exactly matched pre-change SHA-256 d117b731cc0e6674cdc973c917f7f196351313a639b16e387849afa7149db12b: nine plans, 180 historical account rows and 108 reserved slots. Existing schedules, strategies, pauses and batch references remained unchanged. Native UI card click returned all seven launch accounts. Screenshots verified project settings, counts and role cards. The owned browser session was stopped.

## Unfinished work / next step
Implementation, deployment and project binding are complete. The scheduled October 2 execution and October 5 mature outcomes are future events. Missing executors will be created during the normal scheduler scan; no manual publishing run was triggered. The bounded cycle still requires an explicit next-cycle decision before October 9.

The pre-existing untracked factory-cloud/tmp-fill-wait.mjs is untouched. This worktree uses isolated npm-ci dependency directories, with no junctions.