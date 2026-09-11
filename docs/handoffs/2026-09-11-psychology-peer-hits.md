# Psychology peer hits and grokbot import API

## Goal
Add a peer viral-video module in the psychology group with an external write API for grokbot. Store video URL, title, account identity, plays, likes, comments, favorites, shares and additional video data.

## Decisions
- Online module `/psychology-peer-hits`, available to admins, separate from the existing novel peer-hit module. Existing admin sessions acquire its sidebar permission through the normal module normalization.
- Additive D1 migration `0022_psychology_peer_hits.sql`: video records with unique identity and sorted-list indexes; per-admin API key hashes and masked prefixes. Records are shared among authorized admins; full keys are returned only when generated. Migration 0022 was applied successfully to production on 2026-09-11.
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

## Release outcome
- User authorized the combined release with “上线” on 2026-09-11.
- Runtime commit: `270716a391700e2635b3aafac2db22b377dacdcb`, pushed to GitHub main before deployment. The deploy check confirmed a clean worktree and HEAD == origin/main.
- Deployed using `npm run deploy` from factory-cloud. Migration 0022 succeeded; Cloudflare Worker version is `2d3ad1c2-9739-46e9-8c29-be4115c750b7`.
- Production health returned 200. External import without a key returned the expected 401. The authenticated peer-hit page loaded the empty D1 list and key metadata successfully. Live browser checks confirmed all three template pages show Z-Image and the sidebar shows peer hits with the topic-library entry removed. Browser session was closed after verification.
- No real video generation or publishing tasks were submitted, and no bot key or sample record was created in production.

## Next step
The user can open `https://factory.tiktokaitool.com/psychology-peer-hits`, generate a dedicated API key, and configure grokbot using `docs/psychology-peer-hits-api.md`.

The release checkout is `D:/cursor/localfactory/work/psychology-directory-release`. The original `D:/cursor/localfactory` still contains unrelated pending changes and running workers; it was not reset, pulled or restarted. New cloud jobs and older queued payloads enforce Z-Image when delivered to workers.
