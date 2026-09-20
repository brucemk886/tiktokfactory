# Goal

Implement the user's approved reliability and capacity fixes for psychology photo recreation at 200 accounts × 3 posts/day.

# Decisions

- Keep parent creation caps (100 posts / 50 accounts) and at most 20 items per remote group. No automatic 600-post production run was initiated.
- Isolate failed/overdue pending items before freezing a remote request; retain original externalId for submitted/ambiguous requests. Dedicated cron checks every five minutes, with a twenty-minute readiness deadline.
- Back up photo bytes privately before uploading. Only the exact hub HTTP 400 missing/expired-photo rejection permits resetting checkpoints and requeueing existing photo worker jobs; same externalId, two recovery cycles. Restore bytes from R2; old items without backups use their saved render plan. No worker restart required.
- Cache account directories for thirty seconds during checkpoints; final group permission check is fresh. Transient directory failures delay twice and record diagnostics; permanent 403 stops immediately. Precomputed scope keys avoid per-account whole-store normalization.
- Peer allocation prefers less-used sources and avoids reuse on the same account unless explicitly selected; reservations are atomic. Existing creation caps remain because a parent daily-plan feature was not part of this fix.
- Ten parent tasks per page with attention filter; fifty official records per page with filtering before LIMIT and historical handle matching. Summary cards explicitly describe the current page.

# Files changed

- factory-cloud/migrations/0034_psychology_capacity_recovery.sql
- factory-cloud/src/psychology-account-access.js, psychology-photo-recovery.js, psychology-auto-photo.js, psychology-auto-publish.js, psychology-publish-groups.js, psychology-publish-retries.js, jobs.js
- factory-cloud/src/official.js, publish-records-store.js, signal-desk.js, index.js; wrangler.jsonc
- scripts/official-account-group-store.js, psychology-auto-publish.js
- public/psychology-auto-publish.*, official-publish-records.*
- Focused tests, three audit/benchmark scripts, UI integration test and docs/reports outputs.

# Tests performed

- Full factory-cloud suite 466/466; additional account-access/group tests 10/10.
- Real Chromium tooltip regression and psychology-capacity-ui.test.mjs: paging, attention, search reset, dedup default, no page errors.
- Full mocked 600 posts / 3,600 images / 30 remote groups: 200 accounts each get 3 posts; 216 distinct peer sources; 40 directory reads in the fast simulation. No real external API requests.
- Failure isolation: nineteen healthy members submit; expiration restores twenty posts; lost response creates only one remote batch; directory outage defers. Additional tests cover two-retry ceilings, permanent 403, final authorization refresh, stale completion after recovery, atomic source reservation and records beyond 800 / parent batches beyond 30.
- Account-scope benchmark: 200 accounts approximately 4.46 ms, 400 approximately 6.94 ms (Node local, not Cloudflare CPU measurements).

# Unfinished work / limits

- No actual AI/provider/TikTok end-to-end load test or 600-post production run; mock duration and request cache hit rates are not a production SLA.
- Cloud AI planning retains its existing retries/fallbacks and does not gain a new global limiter here. Photo/video share the existing render lane; its concurrency was not increased.
- Historical photo jobs without backups can only rerender; the source background must remain reachable.

# Recommended next step

Observe an operator-created small real batch before scaling. For 200 accounts/day under current creation caps, ten parent tasks of 20 accounts × 3 posts each yields thirty groups. Confirm actual supplier quotas, queue delays and final TikTok receipts; do not infer actual publication from local simulation or hub acceptance.
