# Random compact homepage links

## Goal
Shorten homepage links again and use random codes rather than sequential identifiers.

## Decisions
- Expose https://deeppersonaai.com/ plus a stable random five-character alias (first character 1-9, remaining characters lowercase letters/digits). Remove the /go/ segment. No domain change.
- Migration 0088 backfills every existing canonical link and allocates aliases atomically for new links. Uniqueness is database-enforced; five collision attempts then rollback protect against partial mappings. Allocation uses SQLite random(), public identifiers are not access credentials.
- Preserve original code/account mapping and legacy /go/ URLs. Both routes count against the original code; X-Factory-Link-Code gives the trusted site service the immutable analytics identity. No click, arrival, quiz or payment history is rewritten.
- Link list and overview return the compact URL. Reads stay read-only and existing project/account scope remains. Recopy the new URL into TikTok manually; existing profile links continue working.
- Deploy DeepPersona route compatibility first, then Factory migration and API output. Production verification uses HEAD to avoid generating visits.

## Files changed
- Factory migration 0088, psychology-website-links.js and focused tests, website clipboard browser test.
- DeepPersona worker/short-links.ts and tests/short-links.test.mjs, documented in its docs/2026-10-09-compact-short-links.md.
- CURRENT_STATE, ARCHITECTURE and API guide; generated public guide.

## Tests performed
- Focused SQLite/API/browser checks cover old/new attribution, collision retry/rollback, backfill, GET/HEAD behavior, bots, idempotency, scoped inventory and exact copied URLs.
- Site checks cover immutable click identity, safe forwarding, legacy compatibility and unrelated routes.
- Factory declared suite: 1,477 of 1,478 passed initially; the unrelated Video Hits browser test hit a navigation timeout and passed unchanged when rerun alone. All focused link, migration, permission, funnel and clipboard checks passed. No real publishing APIs called.
- DeepPersona production build, TypeScript check and all 112 tests passed; compatible site deployed and legacy HEAD verified. Factory deployment and read-only verification completed.

- Initial Factory deployment stopped at D1 incomplete input and rolled back (read-only checks confirmed no alias table/trigger or migration receipt). Replaced the terminal CASE guard with the existing repository SELECT RAISE ... WHERE pattern; migration tests also execute Wrangler-split statements.

## Unfinished work
None. Profile edits remain manual.

## Recommended next step
Refresh Independent Website → 引流配置 and copy the new link for each account.

## Release evidence
DeepPersona a63de5bbacb92166502e45626f9d9630b974e064 deployed first (Worker 4161baa0-ba79-443c-a08d-f4ff50403c43), with successful GitHub synchronization. Factory d404508 deployed from a clean checkout already pushed to main (Worker 1fc5de8c-b6aa-4aef-ab88-981f3198b22b) through npm run deploy. Migration 0088 succeeded after the guard compatibility fix; all 21 existing links have 21 unique non-null random aliases. Production HEAD checks for the screenshot legacy link and corresponding compact alias returned identical no-store 302 destinations with the same canonical identity and no click token. Anonymous links API remained 401. No real publication, receiver setting, account profile edit or test visit was created.
