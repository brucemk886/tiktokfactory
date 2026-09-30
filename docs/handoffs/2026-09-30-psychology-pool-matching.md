# Psychology account/content pool matching — 2026-09-30

## Goal
Implement the approved account-pool × content-pool operating strategy and redesign operations/data overview around matching and low-traffic recovery.

## Decisions
- Account tiers are observable median traffic bands, not a TikTok internal weight estimate. Mature observations use publication age >=72 hours and latest cumulative metrics; no exact historical 72-hour snapshots exist.
- Content evidence is locked to source, version, actual text hash, style and style revision. Five mature observations from five different accounts are required before promotion. Source aggregates never promote a specific version.
- Initial live audit found no mature winning exact combinations. Stable accounts therefore consolidate fixed-copy/style baselines, at most five occupied samples per combination; low accounts wait for eligible mature content. Unknown remote outcomes, live retries and deleted-but-uncertain records retain occupancy; confirmed failures release it.
- Weekly two-slot target: strong 12/1/1, normal 10/3/1, rescue 11/3/0 (winner/optimization/exploration). Daily test rounds rotate using a fixed cycle/account seed. Actual fallback/warmup decisions remain visible.
- Diagnostic accounts receive at most six occupied baseline tests until six mature results spanning three sources achieve median >=50. This is a review gate, not an account pause or ban. Source reuse prevention and consecutive confirmed publish failure protection remain.
- Immutable decisions are persisted with each job in the same allocation transaction. Partial shortages skip only affected accounts. Reservation revision collisions roll back all partial writes.
- Migration 0068 adds current/pending strategy overlays and future cycle boundaries without rebuilding legacy constraints. Existing batches/jobs/membership pauses are preserved. Migration 0069 adds immutable match decisions.
- New cycles default to two slots. PATCH /autopilot/id/strategy with revision and days schedules a new pool cycle on the next whole Beijing day after the last reserved date, extending endsAt by the requested days. There is no indefinite renewal.
- Operations defaults to seven days and provides thirty-day review. Both overview and operations separate cumulative/mature observations, frozen actual allocations, retrospective classifications and recovery evidence. Traffic cards and scoped permissions remain.

## Files changed
- Shared pool policy, normalization and strategy labels in scripts.
- Pool matching and pool reporting services, auto-publish and autopilot integration, management API/official report adapters.
- Migrations 0068 and 0069.
- Operations, data overview and autopilot HTML/JS/CSS, API guide and asset manifest.
- Focused policy, scheduler, matching, SQL report and UI tests; API documentation and current state.

## Tests performed
- Full factory test suite: 950 passed, zero failures, zero skips. Tests use local simulated services and do not call GeeLark publishing APIs.
- Matching integration verifies five-account occupancy, confirmed failure release, deleted uncertain retention, source reuse guard, six-test diagnostic review, immutable copy/style/decision, partial results, idempotency and current user/group permissions.
- SQL reporting verifies scope, exact median/zero/null handling, text/style revisions, frozen allocations and recovery comparisons.
- Headless Chrome synthetic UI checks at 1440px and 390px: page errors absent; table overflow stays in its container; seven/thirty-day filters, empty/error/warmup, actual allocation and future continuation dialog verified. Screenshots are outside Git in the task visualization folder.
- Syntax and git diff format checks.

## Release and operations
Ship clean committed GitHub main using npm run deploy from factory-cloud; migrations apply through the existing deploy wrapper. Continue the nine current psychology plans with a seven-day pool cycle after their existing reserved dates. Verify strategy boundaries/end dates and retained paused memberships through scoped read tools. Existing production/publishing jobs are not cancelled or rewritten.

## Unfinished work
No pending implementation. Baseline maturation and low-account recovery require future observed results. First eligible content can only be assessed after its 72-hour observation gate; the report must continue to distinguish this from exact same-age performance.

## Recommended next step
Review actual allocation and baseline readiness after 72 hours of the new cycle, then account recovery after sufficient mature samples. Low accounts with no eligible content need more proven baseline inventory rather than cold-topic fallback. Runtime reservation history has an explicit 20,000-row guard, not silent truncation; large future deployments should move occupancy to an incremental projection.

