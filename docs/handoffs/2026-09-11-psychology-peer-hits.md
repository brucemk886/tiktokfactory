# Psychology peer hits and grokbot import API

## Goal
Add a peer viral-video module in the psychology group with an external write API for grokbot. Store video URL, title, account identity, plays, likes, comments, favorites, shares and additional video data.

## Decisions
- Online module `/psychology-peer-hits`, available to admins, separate from the existing novel peer-hit module. Existing admin sessions acquire its sidebar permission through the normal module normalization.
- Additive D1 migration `0022_psychology_peer_hits.sql`: video records with unique identity and sorted-list indexes; per-admin API key hashes and masked prefixes. Records are shared among authorized admins; full keys are returned only when generated. No production migration has run.
- Dedicated external POST `/api/integrations/psychology/peer-hits` authenticates a module-only Bearer token without a login cookie. It checks that the owner remains an active admin. Tokens cannot read records, change other modules or publish videos. UI key rotation/revocation uses authenticated same-origin admin endpoints.
- Up to 100 records / 1 MiB per request. Validate all before transactional batch write. Video IDs stay strings; URLs and numeric/time fields are validated. TikTok URL IDs deduplicate account-renamed/tracking-link variants; unresolved short URLs need a stable identity supplied by the bot.
- One latest row per video. Omitted/null fields retain current values, zero values are valid, `videoData` uses JSON Merge Patch, and older `collectedAt` inputs are ignored. No history snapshots or remote scraping.
- UI has collapsed API setup and manual import panels, searchable/sortable video metrics and 20-row pagination. Desktop and narrow-screen table scrolling work. Unknown metrics display an em dash rather than zero.

## Files changed
- New `factory-cloud/src/psychology-peer-hits.js`, `psychology-peer-hits-store.js`, and `psychology-peer-hits.test.js`.
- New `factory-cloud/migrations/0022_psychology_peer_hits.sql`.
- New `public/psychology-peer-hits.html`, `.js`, `.css`.
- Cloud `index.js`, `sidebar.js`, `auth.js`, `pages.js`, test script in `package.json`.
- `docs/psychology-peer-hits-api.md`, `docs/CURRENT_STATE.md`, this handoff and prior Z-Image handoff release status.
- The same checkout already contains the earlier pending Z-Image/topic-library changes; retain them for the requested combined release.

## Tests performed
- `npm test --prefix factory-cloud`: 261 tests passed, including 7 new API/storage/permissions tests. Covers sparse upserts, stale data, same-batch duplicates, atomic invalid-batch rejection, pagination, validation, key rotation/revocation, disabled owners and public Worker dispatch without session.
- `node work/check-psychology-peer-hits.mjs`: actual frontend with actual HTTP handler backed by in-memory SQLite and mock admin session. Verified bot inserts/updates, manual imports, pagination, search, zero/null metrics, XSS escaping, key one-time display/revocation and layout at 1600 and 900 pixels. Screenshots inspected. No production API, image generation, TTS or publishing requests were made.
- Script syntax checks and `git diff --check` passed.

## Unfinished / recommended next step
Code is in `D:/cursor/localfactory/work/psychology-directory-release` on main, based on `528da09`. On 2026-09-11 the user explicitly requested “上线”, authorizing this module and the preceding Z-Image/topic-library changes to be committed, pushed and deployed together. The earlier approval block is resolved by that instruction. At preparation of this release commit, deployment and live verification are still pending.

Release steps: fetch/reconcile origin/main while preserving these changes, commit and push main, verify clean worktree and exact HEAD == origin/main, then use `npm run deploy` in factory-cloud (which applies the migration). Verify live sidebar/page and unauthenticated API rejection. Let the user generate their bot key in the UI; do not put it in Git or a handoff.

Original `D:/cursor/localfactory` has unrelated pending changes and running workers. Do not overwrite that checkout or interrupt existing jobs. The previously deployed navigation release remains 528da09 / Cloudflare version 537e28b9-f6ab-43a9-ab52-cccb5fba7d44 until a later authorized release.
