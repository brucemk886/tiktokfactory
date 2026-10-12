# Recreate the ready-material campaign

## Goal
Recreate the authorized psychology campaign on 100 unique accounts in five groups for six rounds, using only ready Video Hits materials and frozen receiver CTAs.

## Decisions
- Fix the durable path that previously hardcoded the copy library and omitted receiver selection.
- Ready video/photo commits atomically fence the scheduler lease, update member outcomes and link partial batches for cancellation.
- Migration 0092 stores fixed account IDs and explicit dated rounds. An inactive/expired project policy no longer excludes accounts in a new independent campaign.
- First night: October 13 Beijing 00:30 and 01:30. Following nights: October 13 23:30 / October 14 00:30; October 14 23:30 / October 15 00:30.
- Five groups have twenty fixed accounts each. All six rounds use ready materials; the last normal-traffic group round may use twenty ready photo albums, making 580 videos plus 20 photos.
- Plans are created paused with stable request IDs, read back, then activated through the existing Factory API. No direct production SQL inserts.

## Files changed
- Autopilot, durable scheduler and task-group execution.
- Ready photo/video batch commit helper and publishing integration.
- Migration 0092, operation UI, generated asset manifest and focused tests.
- Current state, architecture and this handoff.

## Tests performed
182 focused backend and desktop UI checks passed. New integration coverage uses ready videos/photos, the real durable message handler, frozen receiver CTA, fixed roster, duplicate delivery and pause during atomic commit. No real publishing provider is called by tests.

## Unfinished work
No remaining campaign creation work. Uploads and scheduled publication continue in the existing executors; future four rounds are prepared by the durable scheduler.

## Recommended next step
Use Factory publishing records to verify actual results after each round. Keep the five fixed campaign plans active; do not resume the ended attempts.

## Production verification
- Code 845c436 was pushed to main and deployed with npm run deploy from a clean main worktree matching origin/main. Worker version 0556d01d-b730-4c2b-9ef5-761216ccb138. Migration 0092 applied successfully.
- At October 13 Beijing 00:01, the five plans were active with a total target of 600: 580 ready videos plus 20 ready photo albums.
- First-night creation completed: 100 tasks for 00:30 and 100 for 01:30; 100 unique accounts had exactly two tasks each. Every group had forty tasks. All items were from video-hits with frozen receiver snapshots, zero blocked members and zero failed jobs at verification. Upload/Hub submission was still in progress; creation is not confirmation of publication.
- Subsequent October 13 23:30 and October 14 00:30 work was queued for October 13 21:30 and 22:30 respectively. Remaining exact rounds are stored in the plans and fall within the scheduler's later rolling horizon.
- No private account IDs or credentials are recorded here.
