# Psychology independent operating task groups — 2026-09-30

## Goal
Implement the user's selected independent operating task groups, with automatic account assignment, seven-day operating cycles and three-day reviews. Preserve permission groups, frozen jobs, pauses and the already configured October 2–9 three-post cycle.

## Decisions
- Eight roles: content review, strong production, normal production, hook rescue, content rescue, near-zero diagnosis, existing observation, newly enrolled launch. One effective role per account at a time; changes start after reserved dates.
- Default review target is 60 mature strong/normal accounts. Two daily rounds prioritize fixed-version validation; the third prioritizes winners. Fresh mature evidence still disallows cold testing for weak accounts. Existing five-distinct-account content limits, source nonreuse and diagnostic six-test gate remain.
- Initial enrollment is limited to selected existing pool executors. Other existing psychology publishing accounts are registered as excluded. Later newly eligible psychology publishing accounts can enroll automatically. Accounts with conflicting existing plans are visibly blocked rather than silently taken over.
- Administrative groups remain delivery boundaries. New physical groups receive one controlled pool executor; existing selected plans keep their schedules and status. Account pauses are inherited rather than reactivated during admission.
- Daily round claims are atomic with publishing records and unique per policy/account/Beijing day/round 0–2. New members cannot fill historical frozen slots before membership takes effect, and supplemental schedules cannot cross the original date or cycle end.
- The scheduler pages all active plans rather than permanently limiting execution to the first 20.
- Settings do not automatically extend a running cycle. The seven-day cycle expires without automatic renewal. No 24-hour provisional content promotion, new analytics collection or data-overview pool panel is included.

## Files changed
- Migration 0070: policies, registry, membership snapshots, revisions, cycle history and daily allocation claims; executor linkage columns.
- New policy, task-group service and executor bridge modules and focused tests.
- Autopilot routes/scheduler, auto-publish integration, frozen match metadata and review-role matching.
- Autopilot UI: configuration preview/save, role cards, paginated members and blocked-account visibility.
- Architecture/current-state documentation and asset manifest.

## Validation and rollout
Full factory suite: 996/996 passed after all code was frozen; UI tests: 28/28, new execution integration: 12/12. Syntax, asset manifest and diff checks passed. Tests use mocked bridge/workflow implementations and local SQLite only; no real GeeLark publishing calls.

Before rollout, the authenticated seven-day autopilot view recorded 9 plans, 180 historical account memberships and 108 reserved slots. The SHA-256 fingerprint of plan/group/status/end dates, current/pending schedules and strategies, account pause state, and slot/batch identifiers was f18a93351d4349596bd36901ea9f401168bf974d7c9fb9fbbcff459c4765cbbf. Existing future strategy starts October 2 and all nine plans end October 9 Beijing.

## Release and live verification
- Code release 27663ad was committed and pushed to GitHub main, then deployed with npm run deploy from a clean main checkout exactly matching origin/main. Migration 0070 applied successfully. The first Worker attempt returned a transient Cloudflare authentication error; one repeat of the standard command succeeded. Worker version: a5d8357d-c6bc-4b7a-affa-a6b0300a05c0.
- The authenticated UI successfully previewed and saved policy revision 1 for the nine existing plans. Starts 2026-10-02 00:00 and ends 2026-10-09 00:00 Beijing; next review 2026-10-05 00:00. New-account admission is enabled, review target 60.
- Current eligible psychology publishing directory: 187. Initially enrolled: 175; previously out-of-run accounts excluded: 12; blocked: 0. Roles: review 60 (10 strong + 50 normal), normal production 56, hook rescue 10, content rescue 32, diagnostic 16, observing 1. Separate strong production and launch are currently 0 because strong accounts are in the review cohort and no new accounts have yet enrolled.
- After activation the plan/member/schedule SHA-256 fingerprint exactly matched the pre-rollout fingerprint above. The nine schedules, strategy boundaries, pauses and 108 listed reserved slots remained unchanged.
- Live group-card click and next-page interaction succeeded. All three review pages returned 20 rows, totaling 60 distinct accounts. Visual screenshots confirmed readable role cards and member tables. The owned browser session was stopped after verification.

## Unfinished work / next step
Implementation and activation are complete. Future October 2 publishing and mature content outcomes have not happened yet. Review real allocations and mature evidence beginning October 5, and choose the next bounded cycle before October 9. No 24-hour candidate promotion or automatic indefinite renewal is enabled.

The original untracked factory-cloud/tmp-fill-wait.mjs remains untouched. The implementation worktree uses isolated npm-ci dependencies, never dependency junctions.
