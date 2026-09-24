# Pending benchmark accounts and popular comments

## Goal
Separate benchmark account management from the API panel, allow bulk pending prospects without automatic collection, and expose ranked comment text/likes on each library row.

## Decisions
- Top-right 对标账号 opens an independent dialog. Bulk @handles/profile URLs normalize and deduplicate before transactional insertion; max 100 enforced with a DB trigger. All old/new accounts are pending. External watchAccounts stays empty, no daily assignments.
- 查看热门评论 opens saved original comment text and likes for video/photo rows without a live TikTok request. Output is escaped.
- Imports accept up to 100 candidates, deduplicate by trimmed text retaining the highest likes, omit zero-like comments and keep top 20. New API imports normally need 10 comments, capped by the reported total comment count. A genuine shortfall can be explained with topCommentsNote; commentCount=0 accepts []. Existing updates may omit saved fields. Supplying new comments clears an omitted old shortfall note.
- Video/photo enrich lists include missing topics or insufficient comments unless a shortfall is explained. Grokbot rule text and JSON samples updated. No changes to publishing jobs.

## Files changed
- Migration 0053; psychology-peer-hits-store.js and focused peer tests/fixture.
- public/psychology-copy-library.html/css, psychology-peer-hits.js, new psychology-peer-extras.js.
- scripts/psychology-copy-library-ui.test.js; API docs and CURRENT_STATE.

## Tests performed
- 671 tests pass via npm --prefix factory-cloud test; git diff --check clean.
- Focused bulk validation/idempotency/cap, external pending exclusion, comment sorting/dedup/shortfall preservation, and UI escaping/bulk submission tests.

## Unfinished work / next step
- Ship this commit through main and npm run deploy, then read-only browser verification of both dialogs.
- User must copy the updated write rules to Grokbot. Saving prospective accounts does not activate collection. Existing posts without comments still need a Grokbot enrichment pass; no invented comments or production test writes.
