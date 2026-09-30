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
Final integrated factory-cloud suite passed 1,049/1,049; generated asset manifest and git diff --check passed. UI focused tests passed 37/37; policy/execution focused tests passed 65/65; scoped external API passed 9/9. Focused local tests cover Pacific summer/winter conversion, missing/repeated DST clock hours, three rounds across two Beijing dates, calendar cycles/reviews, frozen-task preservation, concurrent transition conflicts, project timezone consistency and original permission/pause behavior. Tests mock external publishing calls.

## Live state before change
Read-only authenticated UI/API verification: policy revision 2, 187 eligible/enrolled, zero blocked/excluded; nine plans and 180 historical account memberships. The seven-day-view projection of plan ID/status/current slots, account ID/status/stopPending and reserved slot times/batch references hashed to 330014270f09879c2605f5ce55f9efa66e5208881128166f92921840794325a8 (108 visible slots). Pending configuration is excluded because it is the intended change; mutable receipts are excluded.

## Production activation
- Core code committed/pushed as d201d99; clean main matched origin/main before npm run deploy. Migration 0072 applied successfully. Initial Worker version 40964146-1211-4d63-ae8a-f5337afd8451.
- Authenticated project UI previewed and saved Pacific configuration. Policy revision 3, enabled project enrollment and auto-admission retained. Local cycle is October 2 00:00 through October 9 00:00 Pacific, first review October 5 00:00. UTC millisecond boundaries: startsAt 1790924400000, endsAt 1791529200000, nextReviewAt 1791183600000; old-boundary prestart cutoff 1790870400000.
- All nine existing plans have pending Pacific slots at 08:00/11:30/20:00 plus their original 0–80 minute offsets, effective at the project start. Historical current Shanghai slots remain unchanged until transition. Account staggering remains 45 seconds.
- Verified 187 enrolled/eligible, zero excluded/blocked. Roles preserved: review 60, strong 0, normal 56, hook rescue 10, content rescue 32, diagnostic 21, observing 1, launch 7.
- Post-save seven-day-view projection matched the pre-save SHA-256 exactly: 330014270f09879c2605f5ce55f9efa66e5208881128166f92921840794325a8. Nine plans, 180 historical memberships and 108 visible slots unchanged. This is a bounded visible-history check, not a claim that every database field was compared.
- Screenshot review confirmed readable Pacific/PDT and Beijing dates and the 11:30 baseline. No immediate-run or manual publishing endpoint was called.

## Unfinished work / next step
Original-plan cards now refresh after a successful project save; list-read failures preserve the confirmed save and last list data. The existing 30-second polling remains. No implementation work remains. Operationally, retain normal scheduled dispatch and observe capacity/content shortages through existing reports; this change does not implement dynamic generation capacity or automatic cycle renewal.

The pre-existing original-workspace untracked factory-cloud/tmp-fill-wait.mjs is untouched. This implementation worktree has isolated ordinary npm-ci directories (no junctions).


## Final release
- UI polish committed/pushed as 3885337, then deployed from clean exact origin/main using npm run deploy. Final Worker version: 4933ff89-e55f-4b17-b62b-865c0aaa7838.
- First polish-deploy migration verification returned Cloudflare 7403 before deployment; one ordinary retry succeeded with no migrations needed. No authorization settings or credentials were changed.
- Public production JS returned HTTP 200 and normalized SHA-256 prefix bb7419e10338a3b4a278, exactly matching the committed asset manifest. The final release changes display refresh only; the verified revision-3 production policy was not written again.
- The agent browser session had already expired during validation; no borrowed user tabs or running agent browser session remain from this task.
