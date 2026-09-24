# Autopilot group directory fix

## Goal
New account groups must show all authorized publishing accounts and schedule them even before their analytics archive exists.

## Root cause / decisions
Autopilot was counting and scheduling from official_accounts_latest, which is a partial analytics archive. Production read-only comparison confirmed group 4 had only 9 archived members and groups 5–10 had 0, despite assigned members being present.
Use the complete paginated Signal Desk publish directory, filtered by current psychology group assignments and video.publish permission. Deduplicate stable connection IDs. Analytics remains separately read for performance, never an enrollment prerequisite.
Persist only IDs, names and scopes in a private D1 KV snapshot. Explicit page visit, create-dialog open and refresh query refreshGroups=1; background status polls read snapshot/current assignments. Failed refresh preserves cache and UI and surfaces the error. Starts and scheduled runs refresh authorization; final publishing checks remain unchanged. No existing groups, memberships or publishing tasks manually changed.
The new-create dialog includes Refresh account groups and progress/error feedback. Labels and slot details can use directory names for unsynced accounts.

## Files
factory-cloud/src/psychology-autopilot.js and tests; public/psychology-autopilot.html/js; scripts/psychology-autopilot-ui.test.js; docs/CURRENT_STATE.md.

## Validation
Tests cover ten groups / 200 authorized accounts with only first 80 archived, two directory pages, startup for group 10 without analytics, local polling, membership moves, failed-refresh cache retention, duplicate/read-only/outside-project/revoked accounts and refresh UI behavior. Full suite results are reported on completion. No real publishing calls from tests.

## Release / next
Commit/push clean main and deploy via factory-cloud npm run deploy. Verify production group counts and directory refresh only; do not start any real pilot as a test. No migration required.
