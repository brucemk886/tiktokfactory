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
Production deployment and campaign creation verification follow this code release.

## Recommended next step
Verify first-night coverage is 200 unique account-round tasks, all sourceType=video-hits and all with frozen receiver snapshots, before reporting creation success.
