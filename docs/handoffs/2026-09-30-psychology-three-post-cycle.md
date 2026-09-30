# Psychology three-post pool cycle — 2026-09-30

## Goal
Increase the existing psychology automated plans to three posts/account/day and use shared account/content pool matching from October 2.

## Decisions
- Nine existing active plans retain their administrative group boundaries. These control permissions, schedules and execution; account performance pools determine content allocation. The same owner's authorized psychology groups share exact-version evidence and sample reservations.
- All nine future schedules were updated through the authenticated, revision-guarded schedule API. Both the schedule and pending pools strategy start at 2026-10-02 00:00 Beijing. The cycle still ends at 2026-10-09 00:00 Beijing; no indefinite renewal was introduced.
- Group 1 starts at 08:00 / 14:00 / 20:00 Beijing; groups 2–9 add ten minutes per group. Account staggering remains 45 seconds. These are distributed operating slots, not a claim of optimal audience times.
- Three posts/day scales the weekly desired quota to 21: strong 18 winner / 2 optimization / 1 exploration, normal 15 / 5 / 1, rescue 17 / 4 / 0. Allocation still depends on eligible content and account state.
- During winner shortage, stable accounts consolidate the same copy/style/revision on five distinct accounts. Five occupied samples wait for >=72-hour observations; increasing daily slots does not enlarge this cap. Low/diagnostic/observing accounts with insufficient eligible baseline content may skip slots. Diagnostic accounts still stop new test allocation at six occupied baseline posts pending review.
- The publishing directory currently has 175 accounts in these nine groups, versus 180 stored membership rows. The theoretical ceiling is 525 daily posts before permission, failure and content eligibility checks. Groups 10 and the abnormal-account group were not added to the run.
- Existing two-post quota labels are explicitly reference examples, with three-post examples added. The allocator/classification thresholds are unchanged. Data overview's deleted matching panel stays deleted.

## Files changed
- public/psychology-operations.js: quota reference explanation.
- public/psychology-autopilot.html: quota reference guide.
- factory-cloud/src/psychology-autopilot.js: strategy rule explanation.
- factory-cloud/src/ui-asset-manifest.js: regenerated hosted asset versions.
- docs/CURRENT_STATE.md and this handoff.

## Validation
- All nine schedule PATCH responses succeeded and returned the expected October 2 boundary; a subsequent read checked three pending slots, unchanged current slots, unchanged member states and unchanged listed existing schedule rows.
- Independent scoped MCP list verified 9/9 three-post pending schedules, unchanged pool-strategy boundary and unchanged cycle end.
- Pure policy review covered six account pools with 1,000 seeds each and exact 21-slot quotas; shared reservations across 189 group/day/round requests remained capped at five distinct cold-baseline accounts.
- Focused existing policy/operations/autopilot UI/backend tests passed 84/84. Full factory suite passed 959 tests with no failures or skips. JavaScript syntax, resource-manifest generation and git diff format checks passed.
- Hosted explanation changes are released through the standard clean-worktree, exact-origin/main deploy command; runtime scheduling changes were separately verified through the authenticated API and MCP.
- No publishing API was called by tests, no existing publishing/rendering job was cancelled or rewritten, and the prior untracked factory-cloud/tmp-fill-wait.mjs was left untouched.

## Unfinished work
New-cycle publishing and >=72-hour performance have not occurred yet. No winning version or recovery effect is promised. Final posts late in the cycle mature after the cycle ends.

## Recommended next step
Review project-wide actual allocation and fixed-baseline readiness after the first new samples are >=72 hours old (starting October 5, subject to actual publication and metric synchronization). Evaluate low-account recovery after six mature observations spanning three sources; decide the next bounded cycle before October 9.

## Release and cleanup
- Code/explanation release f3b7b82b33d3ddb6ea9744c019b16eaff8bffa62 was pushed to GitHub main before deployment. The deploy guard confirmed a clean main checkout exactly equal to origin/main. Worker version: 34af792c-4e90-428f-8639-426094b9d054. Live operations JS matched its committed hash; live MCP showed the new three-post rule and nine unchanged October 2–9 cycle boundaries.
- Worktree archival unexpectedly traversed dependency junctions after an attempted unlink safety check failed, emptying the original two node_modules directories. Both were restored with npm ci from unchanged lockfiles. All sixteen direct dependency versions matched the locks, localhost:3010 still responded with its expected authentication redirect, and the full 959-test suite passed again. No service process was stopped or restarted.
- Do not archive a managed Windows worktree while dependency junctions point at the original checkout. Verify that each unlink actually succeeded before archival; abort archival on cleanup failure. Prefer installing isolated dependencies where practical.
