# Imported photo conversion operations

## Goal
Use ready imported Video Hits photo recreations for automatic independent-site traffic, three posts per selected account at China time 22:30, 01:30 and 03:30. Correct the misleading mandatory-synthesis state for photos.

## Decisions
- New Automatic Operations panel: 导入图文 · 独立站引流. Starts disabled and unconfigured; user will select publishers and receivers later. Save draft, save-and-enable and pause-new-planning are explicit. Existing paused planners and active jobs are untouched.
- Publishers must be in current authorized psychology scope. Receivers require current valid handles, synchronized >=1000 followers and explicit confirmation of their bio test link. Balanced stable routes, self-bio CTA when receiver publishes. Preserve original source copy/images; append the final CTA only in the frozen publish job.
- Frames only, enabled, unarchived, unreserved, uncleaned, complete ordered 1–15 images, title/caption. Reuse cloud photo transport with PNG conversion, no AI generation, narration, rendering or One submission.
- 60-minute preparation window, ten-minute cutoff, no backfill. Up to five allocations per queue delivery, lease/revision fencing, atomic per-account/time unique slots and shared photo/video once-only version reservations. Missing inventory waits; invalid versions temporarily excluded until edited/hourly retry. Prefer accounts with fewer allocations in seven days; fourteen-day same-account original-topic cooldown includes existing manual items.
- Pause and config changes affect only new allocations. Created tasks keep snapshots/retries; failures retain material. Confirmed publish +24h cleanup and original retention reused. Never infer publication from job completion alone.
- Detail/list statuses say 图文待启用 / 图文待补全 / 可发布图文; optional render progress remains a secondary status. Enabled complete photo albums do not require voice scripts. Optional video synthesis retains its stricter voice/original-frame validation. Direct photo link opens the photo picker.

## Files changed
- Migration 0086, imported-photo worker/policy and tests; shared photo transaction hook, account scope helper, scheduling dispatcher/consumer and autopilot route.
- Automatic Operations panel/script/styles; Video Hits status/readiness/API enable validation and photo picker link; canonical API guide/generated asset manifest.
- CURRENT_STATE, ARCHITECTURE and this handoff.

## Tests performed
- Focused fixture tests: Beijing midnight/cutoff, CTA idempotency/self handling/overflow, disabled defaults, receiver/scope permissions, CAS/revocation/lease guards, global once-only allocation, queue recovery, pause/resume, inventory shortage and original-topic cooldown. All provider calls mocked; no live publishing.
- Real Chromium: account selection, explicit link confirmation, save without enable, enable/pause, China times, desktop/390px/320px screenshots; direct photo route and existing Video Hits render/preview regression.
- Full declared suite executed 1,454 tests: 1,453 passed; the sole failure was the expected stale UI asset manifest before regeneration. Final focused suite passed all 50, including regenerated manifest, imported-mode, photo queue, durable scheduling and real Chromium configuration tests. Additional Video Hits browser integration plus imported-mode run passed all 14, and the standalone selected-video/photo Chromium suite passed (including the new direct photo route). No unresolved test failures.

## Unfinished work
User must select publishers and receivers and explicitly enable the new mode. No production publishing has been triggered for verification.

## Recommended next step
Refresh Automatic Operations, configure both account roles and bio-link confirmations, then save and enable when ready.
