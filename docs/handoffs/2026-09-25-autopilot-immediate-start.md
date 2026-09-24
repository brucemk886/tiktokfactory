# Goal
User now explicitly authorizes starting the previously discussed nine-group test immediately, with daily publication starting at Beijing 01:45. This replaces all prior wait-for-start and 00:15 schedules.

# Decisions
Groups named ai自动化运营1组 through 9组, 20 authorized accounts each. Groups1–3 A/evolve,4–6 B/original,7–9 C/rewrite. Seven days, two posts/account/day, second round +30 minutes, group interval10 minutes, account interval45 seconds. Group1 01:45/02:15; group9 03:05/03:35; final account03:49:15. Group10 excluded.
Explicit startNow=true persists start_now via0059. First Beijing date accepts >10-minute-ahead slots and starts overdue preparation immediately. Later dates retain normal two-hour lead. No backdating or direct database job insertion. Preserve existing schedule/receipt/idempotency guards.

# Files changed
0059 migration, autopilot handler/scheduler, creation checkbox and frozen multi-create payload, scheduling/UI tests, state/architecture.

# Validation
727 tests passed. Covers10-minute strict boundary, expired slots, unchanged normal/later-day lead, persisted flag, immediate generation timestamp, future generation and duplicate rerun protection. No real publishing during tests.

# Live activation
All nine pilots were created successfully through the authenticated application API on 2026-09-25 Beijing time. Verified active status, 20 accounts each, seven-day duration, exact A/B/C assignments and the slots above. Each creation produced four stable batches (today and tomorrow, two rounds/day), 720 reserved items total; today's plan is 360 items. Tomorrow's workflows sleep until the normal two-hour preparation boundary. No duplicate pilot or batch creation.

# Recovery
The initial 80 today-items in groups 1 and 2 failed before production on the expired sleepUntil boundary. One was verified/restarted manually and 79 by a bounded script that checked the exact error and Errored status before restart. Stable workflow/item IDs were retained; healthy or sleeping jobs were never restarted. Verified group 3 first round subsequently completed preparation normally. Rendering and upload queues continued during recovery.

# Remaining / next step
Before 01:45, verified first-round group status submitted, 20/20 assets ready and 20/20 per-item remote receipts; frozen schedules span 01:45:00–01:59:15 Beijing. No group error. Latest aggregate snapshot: 360 planned today, 287 pending publication, 14 producing, 59 queued, zero failed (counts continue changing). Creation succeeded for all nine groups. Later publication and analytics continue through the existing application schedules; remote receipt is not proof of TikTok publication. No further manual startup needed.

# Startup correction
The first live immediate-deadline workflow failed before production: Cloudflare rejects sleepUntil dates in the past. Replaced with a persisted remaining duration and relative sleep, skipping sleep when already due. Future replay remains deterministic. Workflow dispatch now uses the documented idempotent createBatch API instead of serial get/create requests; stable task IDs are unchanged. Final suite729 passing. Recover only verified errored pre-production instances; do not interrupt healthy/sleeping work or duplicate tasks.

# Release evidence
Immediate-start feature 0017979, corrective code c0d89fd; Worker deployment 6c48053e-3d77-48ac-aa61-3bf089881931. Migration0059 applied. Both deployments followed committed/pushed main and clean-tree gates. Final code suite729 passing. Activation follow-up changes documentation only.
