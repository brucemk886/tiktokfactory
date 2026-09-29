# Psychology daily profile traffic

Goal: show same-day video activity and profile visits across authorized psychology accounts.

Implementation: new ops-report view=traffic reuses fresh project/group scope, reads bounded daily series from official_accounts_latest.profile_json.insights._daily_traffic without network or video packs. Psychology overview loads this independently, with four summary metrics, coverage, UTC date explanation, missing/error states and 10-account pagination. Daily ratio uses only matched account/day pairs and is explicitly not attribution. Existing post-publication-date lifetime report remains separate.

Producer: sibling tiktokaitool commit f2a977e fetches daily fields once per UTC day through existing paced sync; initial 30 days, rolling 7-day correction, 60-day storage; audience insights remain weekly. Also fixes overwritten metrics arrays. No migration.

Tests: backend coverage/zero/null and permission rejection/revocation pass; existing archive/report suites pass. Full factory run exposed two UI mocks assuming two fetches; updated for third isolated view and 31 focused UI/module tests pass, including traffic pagination, escaping and stale-response protection. Hub build/typecheck/full 304 tests pass. Deployment/live verification follows.

Limitations: TikTok may delay or omit metrics. Today is not real time. No synthetic zero or cross-account/date ratio. History beyond retained 60 days is unavailable. Current shared archive directory remains bounded to existing 5000-account limit.

## Release verification
- Factory code b4acaa2 pushed main and deployed from clean exact-origin/main checkout via npm run deploy; Worker 6f6e7817-9f70-4343-85d5-85cd72b3c588.
- Hub f2a977e pushed main, deployed via npm run cloudflare:deploy; Worker f144d10d-d1c7-4735-92c6-176016dcd4d2.
- Final factory suite: 902 passed, 0 failed. Hub: 304 passed; build and TypeScript pass.
- Live scoped account: upstream and Factory both contain 30 daily rows. Overview last-7-days displays 2527 video views / 17 profile visits = 0.67%, six matched days through Sep28. One of 187 scoped accounts populated at verification; others fill during existing daily 07:00 Beijing full sync. Missing today correctly excluded. Pagination to page2/19 verified; viewport screenshot reviewed.
- No publishing API or jobs changed. Unrelated primary checkout untracked factory-cloud/tmp-fill-wait.mjs preserved.

## Compact overview follow-up
- User requested immediate refresh for all currently active autopilot accounts. Selected distinct connection IDs only where autopilot and account are active and autopilot not expired; submitted 180 existing scheduled/full-sync messages in two batches to signal-desk-tiktok-sync. Existing limiter and weekly audience policy apply. No publish jobs changed. Run metadata is local ignored work/active-traffic-sync-run.json; credentials were held only in memory.
- Moved profile visits and ratio immediately after total views in summary; retained explicit hover explanation of different denominators. Account coverage/details now in bottom native details element, closed initially. Summaries load independently of expansion. Clear stale report state on filter reload. 32 focused UI/module tests pass, including order, collapse and ratio/missing rendering.
