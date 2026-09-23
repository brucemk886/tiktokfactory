# Ops report rebuilt as one analysis framework

## Goal
The report mixed scopes (all content vs. auto photo), time bases (batch creation vs. publish time) and five unrelated tabs. Rebuild it around the operator's decisions with one definition sheet.

## Decisions
- Scope: psychology photo auto-published posts, bucketed by TikTok publish time, counted at 24h. Previous period = adjacent window of equal length. The media filter is gone.
- Outcome: absolute traffic-pool tiers (`VIEW_TIERS`). Diagnosis: views ≥1000 × completion ≥ period median quadrants (star / hook / account / weak / unknown) with an action each.
- Account stages use cumulative synced history (all types): stage before the window vs. now, transitions, and a per-account issue hint.
- Tabs: 总览 (cards vs. previous, tiers, quadrants, daily trend, batch execution folded) / 账号 / 内容 (post ranking, reuse curve, version/style, rewrite of 10k+ posts, first posts, old detailed comparison) / 规则 (live `EVOLUTION` params + stage playbook vs. data).
- Data: `loadResolvedItems` now returns light columns (media type, title) ordered newest first, LIMIT 20000, loaded from previous-period start − 30 days; framework rows are items from previous start − 7 days. The detailed comparison keeps the heavy query but widens it by 7 days and filters rows by publish time.
- `scripts/psychology-copy-insights.js` is replaced by `scripts/psychology-ops-framework.js`.

## Tests
Factory suite 602/602 (framework: tiers, stages, reuse drop, version/style/rewrite, quadrants, transitions/issues/previous period; endpoint shape).

## Unfinished / next
- Experiment slots (fixed share of draws tagged for clean A/B on reuse count and style) — agreed as the next step.
- Use counts only see the loaded history (≤20000 items, previous start − 30 days).
- Saves are not synced by the hub.
