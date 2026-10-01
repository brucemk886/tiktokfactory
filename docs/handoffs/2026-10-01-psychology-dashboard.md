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
Released code 414d6b55816c5844e2d783274aeb4570498d09b9 and label correction ea74c6c, each committed and pushed to GitHub main before deployment. Both npm run deploy runs started from a clean checkout exactly matching origin/main. Migration 0074 succeeded. Final Worker version: 7e6fc4a5-10a8-4e85-8736-6022df727ca3.

Authenticated live inspection confirmed three tabs, 188 project accounts, 1,500 mature samples and six mutually exclusive pools totaling 188 (14/103/6/36/21/8). The Pacific September 30 publication card displayed 347 actually published and 350 scheduled as independent quantities. Observed exact content versions numbered 2,320; all remained unqualified, with a visible five-distinct-account evidence reason rather than empty placeholders. Current evidence separated 28 pending reservations, 1,021 waiting publications and one mature unsynced result.

Native browser checks opened account details with a future October 2 role, returned ten matched exact versions, opened a content version with three mature distinct accounts, and followed one of its three linked accounts. No manual scheduling, pause, retry, cancellation or publication was triggered. Application console had no runtime exceptions; an unrelated browser-extension resource failure was excluded. Health endpoint returned 200. Desktop viewport screenshot and width checks verified the live hierarchy; local fixture mobile layout had already passed. The "pending testing" KPI is labeled 待补测, distinguishing candidate evidence shortfalls from active simultaneous tests.

Original untracked factory-cloud/tmp-fill-wait.mjs retains SHA256 D5E0EDB4A145BDAB4C1533BC3A220AABBA98668BF57DAFE63922873F188A2B97. Other pre-existing untracked handoffs are preserved. Dependencies were isolated ordinary directories, not shared junctions.

## Unfinished work
Implementation, deployment and live read verification are complete. Historical pool movement needs two recorded operating dates before comparison can appear; no historical movement is fabricated.

## Recommended next step
Use the production page for the October 2 Pacific cycle. Continue reading actual qualification shortages and capacity snapshots; user-authorized cycle scheduling remains independent of reporting refresh.
