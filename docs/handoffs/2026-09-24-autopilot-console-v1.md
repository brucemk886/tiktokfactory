# Psychology autopilot console v1

## Goal
Today's execution, actual slot outcomes, exceptions and precise pause scope for existing psychology autopilot.

## Decisions
- Keep A/B/C strategies and Beijing 08:00/12:00/21:00 schedules. No frequency/strategy optimization in this release.
- Today counts by scheduled publication time. Recent 12 slots show receipt-based counts; lazy detail shows account, original/rewrite version, title, status, ID and failure. Only official published receipts imply publication.
- Reuse psychologyItemStatus and durable execution evidence after job cleanup. GET reads local records only; 30-second visible-page polling pauses in dialogs. Existing latest-20-pilot limit remains.
- Creation is a dialog. Pause previews stoppable/protected counts. Planning-only pause preserves jobs; stop-unsent tombstones grouped items only if receipt absent and group waiting/failed with no submission lease, frozen request, response or durable remote acceptance. Mutation rechecks these guards. Queued jobs cancel, running renders finish; tombstoned output cannot enter publication.
- Reservations remain; resume does not recreate stopped work. Manual account pauses and new automatic guards stop eligible pending tasks too. Migration does not rewrite existing paused accounts or cancel/publish existing jobs.
- In-flight scheduling rereads pilot status and applies persisted pause policy after linking each new batch. Fix comma-separated multi-batch membership in failure guard. Latest daily analysis is read separately from the 60-log window.
- Migration 0054: stop_pending for pilots/accounts; last_run_at for pilots.

## Files
factory-cloud/migrations/0054_psychology_autopilot_console.sql; src/psychology-autopilot{,-execution}.js; src/psychology-autopilot.test.js; public/psychology-autopilot.{html,js,css}; scripts/psychology-autopilot-ui.test.js; factory-cloud/package.json; docs/CURRENT_STATE.md.

## Tests
- Full factory suite: 680 passed.
- Database tests: receipts/cleaned failures/retry/Beijing date, planning-only vs stop, active render late callback, frozen/submitting/durable acceptance protection, account scope, idempotency, multi-batch membership.
- UI tests: escaping, refresh failure retains data, pause impact, polling suspension and pause payload/scope.
- Isolated Edge with mock APIs: desktop/mobile, detail, escaped title, pause impact and mutation; zero browser errors. Ignored evidence: work/autopilot-v1-*.png and work/autopilot-ui-check.mjs. No real publishing calls from tests.

## Limits and next step
Exceptions cover latest 12 slots per pilot (first 30 alerts displayed); slot details and existing publication records are available. Already submitted/frozen requests cannot be withdrawn here. Strategy adaptation and supply forecasts deferred. Ship via clean pushed main using factory-cloud npm run deploy, then read-only verify the deployed page/API.
