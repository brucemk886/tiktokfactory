# Remove weekly peer metrics refresh

## Goal
Keep top comments, topic tags and watch accounts; remove weekly metrics backfill.

## Decisions
- Key-authenticated GET now returns watchAccounts and enrich only; no refresh list.
- Removed metrics timestamp/baseline maintenance and peer growth metadata. Historical migration 0051 columns remain inert for compatibility; no data deletion.
- Removed growth labels/sort and growth priority when drawing unjudged originals. Proven own-account performance rules remain intact.
- Updated page and copyable Grokbot rules; no weekly refresh instruction.
- Existing sparse metric writes remain supported for manual corrections.

## Files changed
Peer-hit store and tests, copy library endpoint, evolution and tests, copy-library HTML, peer-hits JS, API documentation and CURRENT_STATE.

## Validation
- Focused store/evolution tests: 28 passed.
- Full factory-cloud suite: 662 passed.
- JavaScript syntax and git diff --check passed.

## Next step
Deploy after commit/push through factory-cloud npm run deploy, then verify hosted UI. User must replace manually supplied Grokbot instructions; no external Grokbot task was changed.
