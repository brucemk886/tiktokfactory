# Psychology future planning hold — 2026-10-06

## Goal
User is changing from viral psychology content to content that directly drives independent-site tests. Explicit instruction: do not create October 7 or 8 scheduled tasks yet. Operating dates are America/Los_Angeles.

## Decisions and production changes
- Disabled project auto-enrollment/controller through the authenticated project settings UI: psychology_task_group_policies id psych-task-proj-psych, enabled=0, revision 7. Existing cycle dates and three-post schedule remain saved.
- Paused all 11 bruce-owned linked publication plans with stop_pending=0. This is the existing "pause new planning, continue already scheduled work" behavior; no end-cycle action and no account-level stop.
- UI impact estimation hit D1 CPU time limit and left confirmation disabled. After reading the handler and passing the existing preservation regression, used an optimistic-revision-guarded configuration-only D1 update and inserted per-plan status logs. No publish item, job, material, allocation, time or receipt was mutated.
- Do not resume these controllers/plans or create October 7/8 tasks until the user confirms the new conversion content/strategy. There is no automatic resume date.

## Verification
- Controller disabled; 11 plans paused, all stop_pending=0.
- Existing recovery cohort still has 547 publish items and zero deleted items.
- No project publish items or durable schedule work exists on/after October 7 00:00 Pacific (October 7 07:00 UTC) at verification.
- October 6 automatic cohort remains early 184, midday 184, evening 179; five explicit diagnostic-cap skips. These are photo posts.
- Project dashboard displayed 194 currently scoped unique accounts; live publishing directory returned 193 publishable accounts. The automatic October 6 roster covers 184.
- Original scheduling mechanism: three checks at Pacific 05:00/08:30/17:00, rolling 26-hour planning horizon; generation 2–3 hours early; seven-day cycle and three-day role review. This planning is now paused.
- Existing "pause planning leaves existing work" regression passed. No real publication API invoked by tests.

## Files changed
This handoff and CURRENT_STATE only. No application code change or new deployment required for this runtime configuration change.

## Unfinished work
- Define the new independent-site test content, actual conversion destination/receiver path and measurements before resuming.
- Fix the existing stopImpact correlated JSON scan causing D1 CPU exhaustion; do not bypass its cancellation protection.
- Existing conversion version remains future-effective October 7 with zero confirmed receiver accounts; it was not enabled/edited by this task.

## Recommended next step
Review the new content and conversion strategy with the user; bind/confirm the required landing path, choose the first new operating day, then explicitly resume controller and plan scheduling. Preserve existing published and scheduled evidence.
