# Manual TikTok account directory refresh

## Goal
Correct Factory account counts after Hub unbinding and implement the user's explicit preference: read the Hub only when Refresh Accounts is clicked.

## Decisions
- Hosted and local account-management routes read a persisted whitelisted directory snapshot on normal page entry. A missing snapshot is explicitly labeled and prompts manual refresh; no automatic Hub request is made.
- A complete manual directory read replaces membership, including an empty result. Matching archives enrich current accounts by stable identity; reused usernames cannot revive old connections. History, assignments and publishing facts are not deleted by directory refresh.
- Failed/incomplete pagination preserves the previous complete snapshot and its timestamp. With no prior snapshot, archived/partial data remains explicitly incomplete and is not persisted as a successful directory.
- Publishing-risk marks are read on manual refresh only and persisted for already scoped identities. The UI no longer makes a separate live publish-accounts request on page entry. Stored snapshots omit credentials, owner emails and full analytics profiles.
- Settings envelopes from both local and hosted backends are normalized. The page displays the last manual directory update time.
- Existing publishing, scheduling, analytics jobs, current execution authorization and Hub cleanup are unchanged. Directory viewing is a saved snapshot, not an authorization gate. The current Hub and Factory scope remains intentionally different.

## Files changed
factory-cloud/src/official.js and tests; public/tiktok-connections.js; shared scripts/official-account-directory.js; local official-tiktok-analytics.js and server route; UI/local service tests; UI asset manifest; CURRENT_STATE.

## Tests performed
Focused backend/local/UI suite: 52/52 passed. Full declared Factory regression: 1552/1552 passed with four workers. JavaScript syntax, git diff and asset manifest checks passed. Tests use synthetic data; no live publishing or account mutations.

## Unfinished work
Production deployment and live page verification remain.

## Recommended next step
After release, click Refresh Accounts once to save a complete current directory. Subsequent page reloads use that snapshot until the next manual refresh.
