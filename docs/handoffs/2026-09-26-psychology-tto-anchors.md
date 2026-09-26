# Psychology template videos: TikTok One anchor publication

## Goal
Add optional TikTok One project-linked publication to the existing psychology video workflow, including four-image and single-image topic-bank templates. Do not switch existing batches or the seven-day photo autopilot.

## Behavior and decisions
- `/psychology-publish` > New task > video > TikTok One project > 挂锚点发布. Default off. Choose an authorized brand and anchored project; the selected context is retained in batch config and frozen group requests.
- Project pages reuse the hub's Beijing daily cache; Refresh Projects explicitly refreshes. Account status is keyed by brand connection + brand account + project + creator. Recheck forces a new check.
- On creation, validate content/account scope, then ensure each selected account is joined to this exact project. Existing confirmed participation is reused; unknown membership uses the existing official join implementation. Failure identifies account, project and upstream error and prevents generation-task creation. No ordinary-publish fallback.
- Factory bridge: GET `/api/psychology-tiktok-one` (admin + psychology-publish grant). Hub bridge: GET/POST `/api/v1/tiktok-one` (existing hub principal); GET connections/projects/prepare, POST action=ensure for one creator. Customer API keys are not accepted.
- Hub batch input gains `tiktokOne:{connectionId,accountId,campaignId}`. The server resolves the canonical invitation/anchor, verifies membership, and persists branded-content fields. Caller-supplied invite/anchor overrides are ignored; raw tto fields without the validated context are rejected.
- Linked tasks keep the verified active administrator as task actor. Preparation revalidates the actor and account settings; final queue submission still revalidates the stored actor. No role elevation of creator owners.
- Existing stable external IDs, group receipts, scheduled publishing, retries and TikTok status reconciliation are reused. Photo carousels do not expose/accept this option. Actual anchor visibility/approval remains TikTok's decision.

## Files
Factory: psychology-tiktok-one service/test, auto-publish normalizer/handler/group serializer, route wiring, optional UI module/controls, UI test harness and test list.
Hub: tiktok-one-hub service/test/route, hub batch serializer, preparation actor check, customer API test harness and test list.

## Validation
- Seven focused factory tests: opt-in/video validation, membership/account/project scope, failure-before-generation, normal-path passthrough, immutable group request/replay and both four/single topic-bank templates.
- Four focused hub tests: canonical project settings, actor/authorization, scheduled queue preparation, replay, project-scoped membership, rejection without fallback.
- Local isolated UI (memory DB, fake external APIs): select topic-bank four-image template, account, opt-in, select project, read membership, create queued task, inspect project label in batch details. No live generation or publication was performed.
- Full suites and production read-only verification are release gates; final results are reported in the task.

## Release and remaining user test
Deploy hub before factory, using each repository's approved npm script from clean GitHub-main-aligned checkouts. Another task's unrelated in-progress topic/copy API changes must stay uncommitted and excluded.
User can create a real opted-in template task and inspect its official project/anchor result. Existing tasks are not retroactively changed.
