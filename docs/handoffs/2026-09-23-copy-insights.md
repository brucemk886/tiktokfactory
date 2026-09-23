# Rewrite delete + 运营规律 monitoring

## Goal
Let admins delete unsatisfying rewrites, and add a data view that shows whether reusing a viral post hurts traffic, when it drops, whether changing style or rewriting helps, and what works best per account stage (起号 / 稳定 / 爆发 / 下滑).

## Decisions
- Delete is a soft delete (`deleted_at`, migration 0047): the row stays so Grokbot re-imports of the same externalId/fingerprint are counted as duplicates instead of reappearing. Deleted rows are hidden from lists and counts, cannot be re-enabled, and are never drawn (they are also `enabled=0`).
- Insights are computed on request inside `/api/psychology-operations` (photo only; `insights: null` for the video filter). Earlier uses of a post are looked up 90 days before the window via `loadResolvedItems` (shared with the evolution rollup).
- Per the operator, views are judged on absolute TikTok traffic-pool tiers (`VIEW_TIERS`: <200 低播放, 200 正常, 1000 潜力, 1万 待爆, 10万 小爆, 50万 爆款, 200万 大爆), not relative to the account. Core metrics per group: median/average views, ≥1000 and ≥1万 rates, average watch time, completion rate, likes/comments/shares. Saves are not synced by the hub's TikTok field list, so they show as missing.
- Stages from matured posts before each post: 起号期 <10; 爆发期 a 10万+ in the last 10; 潜力账号 10+ averaging ≥1000; else 普通账号. Thresholds live in `INSIGHT_RULES` (min 5 samples, drop = median ≤70% of first use).
- Nothing in the draw changes automatically yet; findings are advisory.

## Files changed
factory-cloud/migrations/0047; factory-cloud/src/psychology-creative.js (+test), psychology-copy-library.js, psychology-copy-evolution.js, psychology-operations.js, psychology-peer-hits.test.js, package.json; scripts/psychology-copy-insights.js (+test); public/psychology-copy-library.{html,js,css}, psychology-operations.{html,js,css}; docs.

## Tests
Full factory suite 600/600: delete/tombstone/re-import, insight decline point, version/style/rewrite comparisons, launch-stage fallback, endpoint shape.

## Unfinished / next
- As of Sep 23 no post had been reused, so the tab shows 样本不足 until the library draw produces repeats.
- Once repeats accumulate, feed the learned decline point (per-post use cap) and per-stage best kind back into `planLibraryDraw`.
