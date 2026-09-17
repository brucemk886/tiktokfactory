# Goal

Keep the TikTok authorized-account count stable after a manual account refresh and a browser reload.

# Decisions

- Read the current hosted authorization directory on every account-management page load.
- Merge it with the local analytics archive directory and de-duplicate account aliases.
- Keep the local archive as a fallback when the hosted bridge is temporarily unavailable.
- A manual refresh still performs the heavier analytics archive refresh before reading the live directory.

# Files changed

- `factory-cloud/src/official.js`
- `factory-cloud/src/official-archive-store.test.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test src/official-archive-store.test.js` (4 passed).
- `npm test` (339 passed).

# Unfinished work

- None after deployment.

# Recommended next step

Verify that the account-management page shows the same count before and after a browser reload.


