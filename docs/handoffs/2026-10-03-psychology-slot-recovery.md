# Psychology explicit same-day slot recovery — 2026-10-03

## Goal
Restore missing authorized publication tasks for the current operating cycle. The user explicitly moved the missing early-morning round to 03:30 Beijing and deferred notification design.

## Decisions
- Add an optional single-round recovery body to the existing authenticated per-pilot run endpoint. Both original and actual publication timestamps are required; the target is Beijing today, more than ten minutes ahead, within the original operating day/cycle and two hours of the canonical round.
- Keep the original round identity, project allocation day, time zone, content/role qualification and atomic quota claims. Publication uses the requested time and existing 45-second account staggering. Adaptive generation retains its preparation estimate and begins immediately when that preparation time has already passed.
- Preserve frozen batches and jobs. Recover detached committed batches by verifying deterministic request identities before claiming an empty stale slot; fresh creating claims remain busy. Repeated or concurrent requests do not create an extra round.
- Recovery skips broad daily analysis, video archive reads, other rounds and supplementary scans. Ordinary run behavior and permanent pilot schedules remain unchanged.
- Live ordinary recovery reproduced Cloudflare Error 1102 (resource limits), and isolated sequential requests completed. This establishes a current failure mode; historical invocation logs are unavailable, so the original interruption's exact resource subtype is not established.
- The stale-creating recovery is an explicit incident operation, not an automatic lease reaper. Verify that the original invocation stopped and reconcile committed local batches before using it. Existing submitted/unknown remote actions are not recreated.

## Files changed
- factory-cloud/src/psychology-autopilot.js
- factory-cloud/src/psychology-autopilot.test.js
- factory-cloud/src/psychology-task-groups.integration.test.js
- docs/CURRENT_STATE.md and this handoff

## Tests
Full factory-cloud suite: 1,197 passed, zero failed. Focused autopilot and task-group integration tests passed, including an explicit Pacific October 2 second round moved to Beijing October 3 03:30, immediate generation, original-round quotas, duplicate/concurrent recovery, orphan batch rebinding, fresh claims, permission/pause and date boundaries. Tests use local SQLite and mocked provider endpoints; no GeeLark publishing API is called.

## Release and live validation
Follow the clean main == origin/main deployment gate and factory-cloud npm run deploy. For the authorized live recovery, verify actual items and jobs per original round after each request; a covered response alone does not prove full account coverage. Private live evidence remains under ignored tmp and is not included in Git.

## Unfinished work
Notification delivery and general scheduler checkpoint/watchdog design remain deferred at the user's request. This change repairs explicit current-day backfill, not the multi-pilot Cron architecture.

## Recommended next step
Finish current-day task verification, then design independent failure detection and notification with durable progress on the next work session.
