# Psychology daily profile traffic

Goal: show same-day video activity and profile visits across authorized psychology accounts.

Implementation: new ops-report view=traffic reuses fresh project/group scope, reads bounded daily series from official_accounts_latest.profile_json.insights._daily_traffic without network or video packs. Psychology overview loads this independently, with four summary metrics, coverage, UTC date explanation, missing/error states and 10-account pagination. Daily ratio uses only matched account/day pairs and is explicitly not attribution. Existing post-publication-date lifetime report remains separate.

Producer: sibling tiktokaitool commit f2a977e fetches daily fields once per UTC day through existing paced sync; initial 30 days, rolling 7-day correction, 60-day storage; audience insights remain weekly. Also fixes overwritten metrics arrays. No migration.

Tests: backend coverage/zero/null and permission rejection/revocation pass; existing archive/report suites pass. Full factory run exposed two UI mocks assuming two fetches; updated for third isolated view and 31 focused UI/module tests pass, including traffic pagination, escaping and stale-response protection. Hub build/typecheck/full 304 tests pass. Deployment/live verification follows.

Limitations: TikTok may delay or omit metrics. Today is not real time. No synthetic zero or cross-account/date ratio. History beyond retained 60 days is unavailable. Current shared archive directory remains bounded to existing 5000-account limit.
