# Psychology Pacific operating calendar — 2026-09-30

## Goal
Use America/Los_Angeles for psychology automatic publishing. The user chose Pacific time and corrected the midday round to 11:30; base rounds are 08:00 / 11:30 / 20:00 local time.

## Decisions
- Store an IANA zone and UTC instants. Operating dates, daily three-round claims, matching day/round, seven-calendar-day cycles and three-calendar-day reviews use the audience zone, including 23/25-hour DST days.
- Legacy schedules default to Asia/Shanghai. Explicit project configuration changes the upcoming cycle before it starts, preserving the October 2–9 date labels in Pacific time. Active-cycle timezone changes and frozen future reservations are rejected.
- Retain existing execution-group offsets (ten minutes) and account staggering (45 seconds). New managed executors inherit the project zone and a stable ten-minute offset. A zone-incompatible existing plan blocks its accounts instead of being silently adopted.
- Existing jobs/items and pauses remain unchanged. A pre-start cutoff prevents new legacy posts in the gap between the former Beijing boundary and the later Pacific boundary. New accounts still enter at a safe future local day.
- Project settings preview/save and schedule cards show Pacific time with PDT/PST plus Beijing equivalents. Historical analytics and its date filters remain explicitly Beijing time.
- Production lead remains two hours. This change does not add capacity admission, dynamic production lead, guaranteed on-time publication or indefinite cycle renewal.

## Files changed
- Shared schedule-time helper and focused tests; auto-publish context normalization.
- Migration 0072; autopilot scheduler, project policy/executor and frozen pool/day-claim metadata.
- Autopilot project/schedule UI and focused UI/backend tests; generated UI asset manifest.
- Scoped external management API accepts timeZone with idempotency/permission validation; guide and architecture/current-state documentation.

## Validation
Final integrated factory-cloud suite passed 1,047/1,047; generated asset manifest and git diff --check passed. UI focused tests passed 35/35; policy/execution focused tests passed 65/65; scoped external API passed 9/9. Focused local tests cover Pacific summer/winter conversion, missing/repeated DST clock hours, three rounds across two Beijing dates, calendar cycles/reviews, frozen-task preservation, concurrent transition conflicts, project timezone consistency and original permission/pause behavior. Tests mock external publishing calls.

## Live state before change
Read-only authenticated UI/API verification: policy revision 2, 187 eligible/enrolled, zero blocked/excluded; nine plans and 180 historical account memberships. The seven-day-view projection of plan ID/status/current slots, account ID/status/stopPending and reserved slot times/batch references hashed to 330014270f09879c2605f5ce55f9efa66e5208881128166f92921840794325a8 (108 visible slots). Pending configuration is excluded because it is the intended change; mutable receipts are excluded.

## Unfinished work / next step
Complete tests, commit/push main, deploy through factory-cloud npm run deploy, then use the authenticated project settings UI to preview and save America/Los_Angeles. Verify exact local times, cycle boundaries, account counts and preserved execution projection. No immediate-run/manual publishing trigger is needed.

The pre-existing original-workspace untracked factory-cloud/tmp-fill-wait.mjs is untouched. This implementation worktree has isolated ordinary npm-ci directories (no junctions).
