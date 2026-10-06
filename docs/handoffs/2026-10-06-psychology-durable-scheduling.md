# Psychology durable scheduling — 2026-10-06

## Goal
Prevent a resource-limited or interrupted planning invocation from leaving future psychology rounds absent without recovery or an external alert.

## Decisions
- Replace the hosted three-check serial planning path with durable owner preparation, maintenance and per-slot queue work. Save a manifest of eligible accounts and process at most five accounts per message; renew the continuation as a new message after progress.
- Separate the plan from immutable publish jobs. A five-minute lease, token-fenced D1 transaction and existing account/day/round allocation constraints protect overlapping consumers and lost responses. Existing batch IDs, cancellation tombstones and official receipts are reconciled before creating anything.
- The independent five-minute watchdog derives expected slots from active configuration, including after a wholly missed check. It redispatches queued/stale work, preserves exponential retries and exposes terminal failures after five unsuccessful attempts.
- Strategy preparation still happens at three Pacific checks; seven-day cycle/three-day review, next-day account admission, existing publication offsets and 45-second staggering remain. Generation stays capacity-based two to three hours early. Near-deadline missing work is blocked explicitly below ten minutes; no invented replacement times.
- Owner reconciliation refreshes future completed manifests for newly eligible next-day members. Frozen existing items stay intact. Pool qualification and conversion configuration remain in the existing publication selector.
- Automatic Operations starts with a current-permission-scoped early/midday/evening coverage table and per-account outcomes. Created, ready, accepted and published are different counters; unknown manifests stay unknown. An explicit retry action enqueues future failed planning, never resets publishing.
- Factory sends bounded heartbeat/incident summaries through the existing Hub bridge to existing administrator alert recipients. Hub separately detects a 20-minute heartbeat gap, deduplicates alerts for six hours, immediately escalates warn to critical and retries unsuccessful mail. Mail configuration/delivery issues stay visible.
- Daily reporting/adaptive-generation/transition maintenance continues as separate durable phases and cannot block another owner's slot delivery.

## Files changed
Factory migration 0078; new durable-scheduling and schedule-health modules and tests; auto-publish transaction hook; scoped account selection and execution flags; autopilot/API, scheduled/queue routes and binding; scheduling UI, asset manifest, browser test; current state and architecture. Companion Hub change adds the machine-authenticated heartbeat endpoint, monitor core/tests and existing email sender idempotency.

## Tests performed
- Fault tests cover a missed check, stale lock, lost post-commit response, duplicate delivery, permission removal/pause, next-day effect, empty legacy creating slot, bounded retries, incident thresholds and 100 additional accounts. Publishing APIs are mocked; no test calls GeeLark.
- Factory full regression: 1266 passed before final UI test registration/continuation adjustment; focused ten fault tests and the new browser test passed after these changes.
- Hub build/typecheck and full suite: 309 passed. Email sends are mocked in tests.
- UI browser test verifies counters, escaped account evidence, explicit recovery and absence of stale success after a read failure.

## Unfinished work
Factory memory/resumability correction is deployed (dd3687b, version d444e874-96e1-438a-af3d-eee1108bb4f3). Recovery is progressing; final per-round live counts will be appended. Email is disabled by user request; Feishu destination setup is deferred. Active rendering/publishing jobs must continue; do not reset their execution state.

## Recommended next step
Complete live coverage verification and confirm notification status is email-disabled after the next heartbeat. Feishu will be implemented when the user provides its configuration; do not request Resend credentials.

## Live fault evidence and memory correction
- Initial live queue recovery exposed exceededMemory in Cloudflare tail. Read-only D1 measurement found 3,452 matched items repeating 55.83 MiB of group request JSON, plus ready/results/receipts; both legacy test-state and pool-reservation reads materialized this data.
- Both reservation readers now project only status/receipt/request-presence fields, preserving remote precedence and reservation semantics. Pool scheduling reads the shared allocation revision without performing the redundant legacy test-state scan. No queue or published record was reset.
- Added a multi-megabyte stored-payload fixture asserting compact D1 responses and preserved occupancy, a gap-in-roster stagger test, and a Wrangler splitter regression. Final full factory regression: 1,271 passed, zero failed/skipped.
- Hub release 8e5aa7d / version 35f70cc4-c9b0-48ce-8120-e48c39fb72ec is live. Heartbeats reach Hub, but Resend returns HTTP 401. No local alternative credential is configured. User was asked to update the existing signal-desk RESEND_API_KEY securely; mail is not marked delivered and UI exposes the failure.
- Initial Factory migration failed because of trigger CASE/END splitting; rewritten SELECT RAISE ... WHERE NOT EXISTS applied successfully. Syntax failures are now never bypassed as transient D1 outages. Factory initial release 9fa03c6 / version 38e549b1-d119-4f17-933c-74f1de3fe3b5 is live; memory correction rollout follows.


- Scheduler queue uses one short planning consumer: content-test allocation revision is shared per owner, so concurrent planning produced avoidable revision conflicts. Rendering/publishing concurrency is unchanged. Partial batch ownership now commits atomically with each chunk, so stop-pending and reporting work before an entire round finishes. Targeted publishing/queue regressions after this change: 123 passed.

