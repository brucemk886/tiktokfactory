# Psychology project pool dashboard - 2026-10-01

## Goal
Ship the selected automatic-operations redesign: option 2 compact top overview, option 1 seven-day trend, and option 2 account pool left / content pool right, with dedicated account and content tabs.

## Decisions
- The earlier local design prototype was insufficient for the user's implementation intent. This release integrates the chosen layout into /psychology-autopilot with real read-only data.
- Existing execution controls, plan history, pauses, scheduling and project settings are preserved under collapsed execution details. Data Overview remains free of pool logic.
- Full current psychology project scope is canonicalized in SQL; totals are not sums of paginated delivery plans. Existing administrator permission semantics remain unchanged.
- Today means Pacific actual publication date; scheduled-date totals are separate. Classification uses rolling 30-day mature evidence, independently of historical execution date controls.
- Exact text hash, source/version, style and style revision are separate content identities. Evidence counters separate reservations, published waiting for 72 hours, matured missing metrics and valid mature results. A winner needs five mature samples from five distinct accounts and current eligible text/style inventory.
- Current/future operating roles are separated by effective time. The actual project controller owns policy and inventory checks; viewer scope still controls visible accounts and facts.
- Seven-day trend compares actual publication-day cohorts using current cumulative mature metrics; it is not daily incremental traffic. Recent dates without mature observations stay missing.
- True account-pool observations begin at the existing three daily checks, with atomic immutable capture tokens and 14-day retention. GET does not backfill or scan the generation queue. Observation failure does not stop normal planning.
- Preparation, publication and next-day admission policies are unchanged.

## Files changed
- public/psychology-autopilot.html/.css, new psychology-autopilot-dashboard.js.
- New backend dashboard and observation services/tests; minimal autopilot GET routing and production-check snapshot hook.
- Migration 0074; package test entries; generated UI manifest.
- New structural/client UI tests; CURRENT_STATE and ARCHITECTURE.

## Tests performed
- Factory full regression: 1,130 passed, 0 failed. An initial isolated-environment run lacked root Puppeteer dependencies and had a stale asset manifest; both were corrected before the passing full run.
- Backend tests cover canonical/foreign project scope, current/future roles, Pacific DST, zero/null, exact identity, progress cohorts, linked detail, current inventory and multi-admin project controller.
- Observation tests cover exact 72-hour boundary, median frequencies, DST, immutable duplicate captures, atomic rollback, retention and failure isolation.
- Client tests exercise GET-only reads, escaping, filtering, pagination, search, keyboard tabs, stale responses, visible-view consistency, evidence queries and linked navigation.
- Local browser fixture inspected at desktop 1330x915 and mobile 320x900. No page-level horizontal overflow; pools stack and metric cards become 2x2. Original image/prototype hierarchy was retained. Synthetic preview data never enters production code.
- Tests use mocked publication/network operations, not GeeLark publishing.

## Deployment
Pending final commit/push, clean exact main verification, npm run deploy, and authenticated live read checks. Release evidence will be recorded below.

## Unfinished work
No code work remains after deployment verification. Historical pool movement needs two recorded operating dates before comparison can appear; no historical movement is fabricated.

## Recommended next step
Use the production page for the October 2 Pacific cycle. Continue reading actual qualification shortages and capacity snapshots; user-authorized cycle scheduling remains independent of reporting refresh.
