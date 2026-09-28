# Autopilot low-view pause removed

## Goal

Keep the 38 accounts paused on 2026-09-28 publishing through 2026-10-01, and stop the rule that pauses an account once its five newest matured posts are all under 200 views.

## Decisions

- Consecutive publish failures (3) still pause an account and cancel unsent local tasks.
- Backfill only future slots that are already `created` and more than 5 minutes away. An active account whose item on that slot was cancelled gets a new one. Past slots are not recreated.
- Restored accounts are scheduled 45 seconds after the last live item in the slot. Later days (Sep 30 and Oct 1) are still created by the 00:00 and 08:00 Beijing runs.

## Files changed

- `factory-cloud/src/psychology-autopilot.js`
- `factory-cloud/src/psychology-autopilot.test.js`
- `public/psychology-autopilot.js`
- `docs/PIPELINE.md`
- `docs/CURRENT_STATE.md`

## Tests performed

- `node --test src/psychology-autopilot.test.js ../scripts/psychology-autopilot-ui.test.js`

## Unfinished work

- Production resume of the 38 accounts and the Sep 29 backfill happen after this change is deployed.
- `factory_kv` key `autopilot-fill-missing-v1` runs autopilot once from the minute cron. Remove that hook after the backfill finishes.

## Recommended next step

Confirm each restored account has two Sep 29 items, and that Sep 30 / Oct 1 include them when those slots are created.
