# Psychology grouped publishing (20 posts)

## Goal
Make psychology automatic photo/video publishing submit groups of up to 20 posts instead of one remote batch per post. A creation request accepts 1–100 posts; e.g. 50 becomes 20/20/10.

## Decisions
- Migration 0030 stores fixed group membership, per-item ready asset snapshots, frozen request bodies, submission leases, errors and remote receipts.
- Generation/upload remains per item and can run on different workers. A group submits only when every member is ready; other groups proceed independently. Failed generation/upload is retried per item; failed submission is retried per group.
- Group externalId and per-item externalRef are stable. Requests are frozen before network calls; cached remote receipts recover a failed local record write without creating another batch.
- Video publish-lane jobs now upload only, then report readiness to the cloud. Successful uploads have a local checkpoint plus cloud readiness. Photo assets retain existing per-image checkpoints, cover order, music selection and copy settings.
- Worker claim capability psychologyBatchUpload prevents old workers from claiming new grouped jobs. Updated render workers always request cloud publish follow-ups for grouped jobs, including before hello resolves. Worker ownership and current account scope are checked again before uploading/submitting.
- Existing tasks have no group IDs and retain their original single-item submission/retry behavior. No old posts were replayed, migrated or republished.
- Page shows group counts, ready/submitted states, remote batch IDs and group retry. Operations reporting no longer assumes that a completed grouped upload equals remote submission.
- Novel publishing is unchanged.

## Files changed
- factory-cloud/migrations/0030_psychology_publish_groups.sql
- factory-cloud/src/psychology-publish-groups.js, psychology-auto-publish.js, psychology-auto-photo.js, jobs.js, psychology-operations.js
- scripts/psychology-batch-upload.js, factory-cloud-worker.js, server.js, psychology-auto-photo-job.js, psychology-auto-publish.js, psychology-operations.js
- public/psychology-auto-publish.{html,js,css}
- Focused automation/worker/report tests and factory-cloud/package.json

## Validation
- Full factory-cloud test suite and root worker tests.
- SQLite/API mocks: 100 items = five groups; 50 = 20/20/10; unfinished groups do not block ready groups; account/schedule preservation; 3 photo posts = one remote batch; per-item records and music/cover correctness.
- Lost response uses identical request/externalId; upload checkpoint reuse; current lease excludes duplicate submissions; expired lease/local-write failure recovers from saved receipt.
- Permission revocation, wrong worker, invalid assets, old-worker claim exclusion, legacy photo path.
- Headless Chrome local mock: group display/retry, ready counter, 50-item creation, photo options and mobile no-overflow. Screenshots under ignored tmp/psychology-groups-*.png.
- No paid generation or live publishing invoked by tests.

## Release / next step
Commit and push main, deploy via factory-cloud npm run deploy, then reload the local worker only while idle so it picks up the upload-only callback. Other worker machines must update/restart before claiming new grouped jobs. Live smoke checks are read-only; user can create the next actual batch.
