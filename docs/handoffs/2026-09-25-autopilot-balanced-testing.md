# Goal
Give original and reviewed rewrite copy comparable initial testing opportunities across A/B/C psychology autopilots, with bounded cold-test allocations and staggered schedules.

# Decisions
New autopilot batches freeze balanced-v1. A starts both types, then approximately 70% proven / 30% exploratory picks. B originals only; C rewrites only, never original fallback. Each version starts with three occupied samples shared across the owner's strategies. Queued/producing/published-not-mature/uncertain outcomes occupy slots; confirmed failure/cancellation releases. Mature means three published >=24h samples with available archived views; rollup still twice daily over 30 days. At most two unjudged enabled rewrites per source are active, retaining started experiments first. Same source never reappears on an account and same version is not repeated within one batch.
Migration 0058 serializes fair allocations by unique owner/revision in the batch transaction. Failed concurrent allocation rolls back all rows and reports retryable conflict. Ordinary manual batches retain legacy draw behavior; occupancy includes their committed history but manual creation is not part of the new serialization.
Paired candidate order uses Beijing date and daily round ordinal instead of exact timestamp. Histories/quotas may produce differing final selections; this is not a guarantee of exact matched experimental pairs.

# Files changed
psychology-copy-testing.js and tests, 0058 migration; psychology-auto-publish normalization and transaction; autopilot strategy rules and pair seed; UI shared rules and asset version; package test list; CURRENT_STATE and ARCHITECTURE.

# Tests performed
Final full suite 724 passing; focused suite 11 passing including a pure local 9-group x20-account x2-round allocation (360 items) with no source/account repetition, no unjudged version above three samples and 30-minute same-account intervals. D1-compatible in-memory transaction rollback, idempotent retry, scope, live occupancy, definite vs ambiguous failures, strict C, mature/exploration branches covered. Isolated Edge mock UI verified strategy text, nine-group creation, edit settings, mobile overflow and no JS errors. No real generation or publishing called.

# Pending user-approved test configuration — DO NOT START until user says 开始
9 groups: 1–3 A, 4–6 B, 7–9 C; seven days. Each account two posts/day. First group Beijing 00:15 / 00:45. Each next group +15 minutes: last group 02:15 / 02:45. Group-internal 45-second offsets remain, same account's rounds 30 minutes apart. Previous 08:00, 22:00 and 22:30 proposals are superseded. Configuration not activated or saved as live pilots. Verify actual group IDs, account counts and eligible original/rewrite inventory before starting. Start must precede first slot by >2h (before prior-day 22:15 for 00:15); current scheduler skips nearer slots.

# Throughput assessment requested by user
360 items/day assuming 9x20x2. Peak approximately 40 items/15min as the two rounds overlap. Preparation starts two hours before each post. Cloud render consumer cap is 20; historical real synthetic render benchmark at concurrency two: 20 posts/120 images in ~54 seconds. This excludes upload and TikTok handling; no full 360-item end-to-end production load test. Stored library copy bypasses on-demand extraction/rewriting, so rendering is expected to have headroom; do not promise an end-to-end SLA.

# Remaining / next step
Commit/push main and deploy through factory-cloud npm run deploy; verify new API rules read-only. Keep pilots unstarted until explicit user command. On command, check enough content/authorization and establish the calendar day rather than silently skipping the requested first round.
