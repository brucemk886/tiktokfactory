# Goal
Restore the factory authorized-account directory from 65 archived rows to the current 115 active hub accounts.

# Diagnosis
Production read-only checks: hub D1 has 115 active connections and 115 corresponding account rows; factory D1 has 65 archived rows. Factory /api/private-tiktok/accounts returned 65 with source=archive-fallback, while /api/official-tiktok/publish-accounts returned 115. The one-account connection test succeeded. No evidence of account deletion or overwrite.

The hub listBridgeAccounts fetches a 100-connection page, then used source=? plus username IN (100 placeholders): 101 bindings, beyond D1's 100 limit. A real SQLite/Drizzle test with the fixture's D1 parameter assertion reproduced the failure before the fix. The factory swallowed the directory error and presented archive count as a successful authorized count.

# Decisions / files
- Hub lib/local-factory-bridge.ts binds page keys as one JSON value via json_each, keeping the existing owner/group scope and cursor semantics. tests/scoped-sync.test.mjs exercises 100+15 pagination and outsider exclusion.
- Factory src/official.js exposes directoryComplete/source/warning, logs only aggregate counts and HTTP status, and marks failed/invalid/incomplete pagination explicitly. public/tiktok-connections.js displays a visible fallback warning rather than claiming a current authorization total.
- No credentials, account assignments, publishing jobs or actual account data were mutated.

# Validation
- Hub: 233/233 tests including build, plus tsc --noEmit.
- Factory: 499/499 tests, including complete 115 vs archived 65, upstream failure, later-page failure and invalid cursor.
- Mock Chrome UI verifies successful 115 count and explicit incomplete 65 warning without page errors.

# Unfinished work
Deployment and authenticated production verification are reported in the task response.

# Next step
Confirm a normal account-page reload returns 115 with directoryComplete=true and source=archive+live. Subsequent live failures must visibly identify cached/partial results.
