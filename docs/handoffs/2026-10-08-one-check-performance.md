# Psychology One membership checking performance — 2026-10-08

## Goal / evidence
Resolve account rows lingering in checking. A read-only production check took 7.755 seconds for one unconfirmed account. The browser checked accounts serially; Hub prepare fetched publishing settings and reread the same project. Rows still waiting appeared as checking.

## Decisions / changes
- Factory GET prepare retains account scope validation but proxies the new Hub membership resource. No project joining or publication happens on inspection. Its bridge deadline is 25 seconds with actionable timeout guidance.
- Hub companion commit bf93e15 separates lightweight membership from full publication preflight and reuses project video IDs. Deploy that Hub runtime first.
- Browser checks at most three accounts concurrently, showing waiting/checking/completed rows, completed count and elapsed time. Each browser read aborts after 30 seconds, so slow accounts do not indefinitely block the others.
- Selection/project changes abort obsolete reads; late replies cannot overwrite the new state. Disable repeated recheck and join while the inspection is active. Failure results remain retryable.
- Existing confirmed membership, creator scope, project isolation, explicit join confirmation and final publication safeguards stay intact.

## Files changed
- public/psychology-tiktok-one.js, public/psychology-auto-publish.js.
- factory-cloud/src/psychology-tiktok-one.js and endpoint tests.
- scripts/psychology-one-check-ui.test.js, factory-cloud/package.json, generated UI asset manifest.
- docs/CURRENT_STATE.md, docs/ARCHITECTURE.md and this handoff.

## Validation
- Focused concurrency, timeout, cancellation and endpoint coverage passed.
- Full factory suite: 1,297 passed, zero failures.
- Existing isolated browser regression passed on desktop/mobile: video preview, join cancellation, mixed outcomes and retry, project isolation and final confirmation. No real publishing API calls in tests.
- Hub companion production build and 382 tests passed.

## Unfinished work / recommended next step
Deploy Hub first, then commit/push main and deploy factory with npm run deploy under the exact clean-main gate. Recheck one account on the production page to compare response time. No account joining or video publishing is authorized or required by this investigation.

## Release verification
Runtime commit 7994ede deployed using npm run deploy after clean exact origin/main verification, after Hub bf93e15. An initial Cloudflare D1 migration-list network fetch failed safely before deploy; normal command retry succeeded. Factory Cloudflare version 29a40a89-f784-4512-b015-bfbe168ac00c. A new production browser capture verified the same account/project read at 4.444 seconds versus 7.755 seconds before, returning the expected unknown status and exiting checking. This is a single observed sample, not a latency guarantee. No live join/publication. Release capture stopped/exported outside Git and browser session closed.
