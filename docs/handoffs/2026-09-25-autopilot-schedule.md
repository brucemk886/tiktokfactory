# Configurable autopilot group publication schedules

## Goal
Configure each group's daily posts/account and publication times, and spread generation pressure when groups are staggered.

## Decisions
1–10 distinct Beijing time points, one post/account/time. Defaults remain 08:00/12:00/21:00 for compatibility. Multi-create accepts shared defaults, individual counts/times and explicit offsets (default 15 minutes); offsets beyond the same day are rejected. Preserve 45-second account staggering across 50-account batch chunks and reject last times that would spill into the next day for current membership.
Existing groups edit via owner/admin-scoped PATCH /api/psychology-autopilot/:id/schedule. Migration 0057 stores pending slots and an effective Beijing midnight after all reserved slots. Previously created generation/publication remains untouched. CAS protects revisions and new reservations. A future pending schedule already reserved cannot be replaced until effective, avoiding overlapping generations of schedules. Expired pilots and edits with no remaining effective day are rejected.
Autopilot's internal call freezes generateAt and available_at two hours before each individual post. The photo workflow sleeps durably before provider work, then checks for cancellation. No new cron, queue or public provider-delay parameter. Ordinary manual batches and existing jobs are unchanged. Initial creation only plans slots more than two hours away, as before.

## Files
0057 migration; psychology-autopilot and tests; psychology-auto-publish; peer-photo-workflow and focused tests; public autopilot HTML/JS/CSS; UI tests; CURRENT_STATE and ARCHITECTURE.

## Validation
Focused tests cover slot validation, day boundaries, one-post allocation, frozen generation timestamps/stagger, deferred edits preserving items, scope/errors/ended plans, repeated pending edits, workflow sleep and cancellation, multi-group count/time payloads and invalid offsets. Headless Edge exercised nine one-post groups staggered 15 minutes and editing an existing group, using mock APIs only. Desktop screenshot reviewed and mobile overflow checked. Full factory suite: 708 tests passed; 712 passed after integrating the concurrent rewrite page-recovery update. No production jobs or pilots created/modified during verification.

## Remaining / release
Commit/push main, deploy via factory-cloud npm run deploy (applies 0057), then read-only verify live settings and API. Other agent copy-library work was present initially and subsequently committed separately; preserve it.
