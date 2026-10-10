# TikTok One report tabs — 2026-10-10

## Goal
Show TikTok One separately in Psychology Data Overview and Operations Report, and first verify the real official API response.

## Decisions
- Read-only live Hub admin report confirmed a two-page official response with 33 videos at investigation time. Actual normalized fields include video/creator IDs, provider time text, total/organic/paid views, engagement and anchor exposure/clicks. Some rows lack values; some older rows contain anchor clicks. The normalized report exposes no audit state. This total is project report scope, not the count of the latest Factory batch.
- Add a shared PC tab; default to official One data with a separate Factory task source. Keep original reports available and lazy-load One only when selected.
- Source official: a whitelisted Hub bridge forwards only validated project/read parameters. Factory requires the exact report module and canonical current account/group scope, only accepts project contexts from authorized historical One tasks, and filters official rows before returning aggregates. Exact video ownership wins over handles; conflicting identities are excluded. No raw brand credentials exposed.
- Fetch every official page up to 20 (at most three concurrently), deduplicate IDs, and flag partial results. Two-minute per-runtime upstream cache never caches authorization. Explicit refresh bypasses it. No report GET writes, production jobs, migrations or worker restarts.
- Preserve zero vs missing values; CTR uses only rows with both numerator and denominator. Official returned cumulative metrics are distinct from date parameters for daily report data and from local planned/actual Beijing publishing dates. Provider timestamps are shown verbatim rather than guessing a timezone.
- Factory source uses frozen One task config and durable facts, retaining only once-owned video metrics after media/job cleanup. No ordinary videos from the same account are counted. Neither official inclusion nor Factory submission is labeled approval.

## Files changed
- factory-cloud/src/psychology-one-report.js and psychology-one-official-report.js, index.js, focused tests and package.json.
- public/psychology-one-report.js/.css, shared overview and operations HTML/initial load guards.
- scripts/psychology-one-report-ui.test.mjs; generated asset manifest; CURRENT_STATE and ARCHITECTURE.
- Companion Hub: lib/tiktok-one-hub.ts and tests/tiktok-one-hub.test.mjs.

## Tests performed
- Factory: 65 focused tests passed, covering task isolation, deduplication, zero/null, pagination, date basis, no writes, current scope/alias revocation, official pagination/cache/scoping, denied contexts, partial reports and upstream errors.
- Hub: 57 One report/publishing/bridge tests passed, including report parameter whitelist and rejection of customer/non-admin callers. TypeScript noEmit passed.
- Additional 28 Factory module/asset integration tests passed (93 Factory tests total).
- Real Chromium local PC test passed for both pages, separate official/task content, pagination, account views, error/retry, original-report return and non-psychology isolation. Title/selected-tab contrast verified. Only mocked API calls during tests.

## Unfinished work
Production deployment and live verification pending.

## Recommended next step
Open either page's TikTok One tab. Official project data shows One performance; Factory task source shows upload/publication progress. Review in TikTok One for approval because the report does not return that state.
