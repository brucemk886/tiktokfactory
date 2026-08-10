# Official TikTok Bridge

## Goal

Remove the complete legacy authorization, connector, destination database, and fallback workflow from Local Factory. Keep TikTok authorization on the hosted `tiktokaitool.com` product and let Local Factory consume the hosted official-data bridge.

## Decisions

- Keep the existing `tiktok-connections` module ID and page path so saved sidebar permissions and bookmarks remain compatible.
- Rename the visible module to `TikTok 官方账号`.
- Use `https://tiktokaitool.com` as the default bridge base URL.
- Do not retain a legacy connector or local PostgreSQL fallback. Remote bridge failures are surfaced directly.
- Do not restart the running Local Factory service as part of this change.

## Files Changed

- Added `scripts/official-tiktok-analytics.js` and its focused tests.
- Added `scripts/private-tiktok-signals.js` for provider-neutral private metric aggregation.
- Replaced legacy server routes with `/api/private-tiktok/*` bridge routes in `scripts/server.js`.
- Rebuilt `public/tiktok-connections.html` and `public/tiktok-connections.js` as an authorized-account view and hosted authorization entry point.
- Updated the single-video detail page, operation brain, Codex prompt, sidebar labels, and current-state documentation.
- Removed the legacy connector/destination modules and tests.
- Removed the `pg` dependency and its lockfile entries.

## Tests Performed

- Node syntax checks passed for the new service, shared signal helper, server, connections page script, and video detail script.
- `node --test scripts/official-tiktok-analytics.test.js scripts/operation-brain.test.js scripts/local-auth.test.js` passed: 23 tests, 0 failures.
- Repository scan found no remaining legacy connector names, routes, callback routes, or service references in source, public assets, docs, or package metadata.

## Unfinished Work

- The hosted bridge contract still needs a real authenticated integration check against the production `tiktokaitool.com` account after the running local jobs are finished and the service is deliberately restarted.
- No production authorization, deployment, database migration, Git commit, or push was performed.

## Recommended Next Step

After active jobs finish, restart Local Factory, configure the hosted bridge key from the admin page, and verify that an account authorized on `tiktokaitool.com` appears locally with its videos and private retention metrics.
