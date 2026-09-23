# Psychology autopilot (one-week, three-group experiment)

## Goal
The operator hands three psychology groups (20 accounts each) to the system for a week: pick content, analyse data, adjust accounts and create publish tasks without manual batches, with the three groups on different content strategies.

## Decisions (operator-approved)
- Groups: the operator creates three new 20-account groups and starts one autopilot per group on `/psychology-autopilot`.
- Strategies: A `evolve` (original first, 70/30 by data), B `original` (never rewrites), C `rewrite` (least-used rewrite first, original only when a post has none). Passed as `libraryStrategy` to the library draw; the per-account "never the same viral post twice" rule and the proven/fresh post split stay.
- Paired draw: every batch the autopilot creates carries `pairSeed = owner:slotMs`. With a seed, `planLibraryDraw` walks one shared post order (70/30 proven/fresh from a seeded generator) instead of per-slot coin flips, so all of an owner's groups get the same viral posts at each slot and differ only in version. Accounts consume posts in the same order, so groups stay aligned over the week. Risk accepted: each post goes out on about one account per group at the same slot.
- Schedule: 3 posts per account per day at Beijing 08:00 / 12:00 / 21:00, accounts staggered 45 s (`staggerSeconds`, new optional config field; omitted when 0 so old batch configs are unchanged).
- Guard: pause an account after 5 matured posts since the start all under 200 views, or 3 failed publishes in a row. Paused accounts can be resumed manually.
- Runs twice daily from the scheduled steps (after the performance rollup) and on demand from the page. Slots 2–26 h ahead are claimed per `(autopilot_id, slot_at)`; failed slots retry; batches are created as the owner through `handlePsychologyAutoPublish` with a deterministic request id.
- Daily analysis reuses `frameworkFor` (same numbers as the ops report) over the last 7 days and is logged with findings and stage counts; the page compares the groups.

## Files
factory-cloud/migrations/0048; src/psychology-autopilot.js (+test), psychology-auto-publish.js, psychology-copy-evolution.js, psychology-operations.js (`frameworkFor`), index.js, pages.js, sidebar.js; scripts/psychology-auto-publish.js; public/psychology-autopilot.{html,js,css}; links from auto-publish and ops report pages; docs.

## Tests
Factory suite 610/610 (slots, guard, strategies, stagger validation, start → batches as owner → idempotent re-run, paused accounts skipped, pause/end, supply shortage logged).

## Supply on 2026-09-23
382 completed photo originals and 1920 enabled rewrites over 384 posts: a week needs 21 distinct posts per account.

## Next
- After the week, compare the three groups on the page and in the ops report (group filter), then promote the winning strategy.
- Possible extra levers once data exists: per-stage strategy, slot times learned from data, posts per day per stage.
