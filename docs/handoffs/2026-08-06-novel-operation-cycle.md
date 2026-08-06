# Novel AI Operation Cycle

## Goal

Prevent autonomous novel operations from running indefinitely by adding a bounded operating cycle.

## Decisions

- The default cycle is 7 days and can be configured from 1 to 30 days.
- A cycle starts only when automation is enabled and at least one GeeLark account group is selected.
- Expiry disables both scheduled analysis and automatic task creation.
- Expiry also blocks new manual plan generation and approval until automation is re-enabled for a fresh cycle.
- Tasks that were already created or scheduled are not cancelled at cycle expiry.
- Re-enabling automation after expiry starts a new cycle from the current time.
- Model/provider/API configuration is no longer exposed on the operations page; the page presents only the generated strategy and business controls.
- The separate configurable account ceiling was removed. Selected groups supply the account pool, while a fixed 300-video daily hard limit is enforced by the service.
- Scheduling labels now explicitly distinguish the first-post random range from the interval between posts on the same account.
- Account judgments now have an independent reset baseline. A reset hides prior account classifications immediately and prevents historical public analytics, private Fivetran signals, and old plans from repopulating them.
- Resetting judgments does not delete analytics snapshots, publish records, generated videos, or queued publishing tasks.

## Files Changed

- `scripts/operation-brain.js`
- `scripts/operation-brain.test.js`
- `public/operator.html`
- `public/operator.js`
- `public/operator.css`
- `scripts/tiktok-analytics.js`
- `scripts/tiktok-analytics.test.js`
- `scripts/fivetran-destination.js`
- `scripts/server.js`
- `docs/CURRENT_STATE.md`

The Novel AI Operations asset-group selector now reads the API's `totalAssets` field (with compatibility fallbacks), so indexed material counts display correctly.

## Tests Performed

- `node --check scripts/operation-brain.js`
- `node --check public/operator.js`
- `node --test scripts/tiktok-analytics.test.js scripts/operation-brain.test.js` (29 passed)

## Unfinished Work

- None.

## Recommended Next Step

- Refresh Novel AI Operations and verify that only the generated strategy is shown, then save the desired schedule and source settings.
