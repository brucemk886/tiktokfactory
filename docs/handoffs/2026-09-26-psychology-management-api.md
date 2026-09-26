# 2026-09-26 Psychology management API

## Goal
Add external read/create/update APIs to psychology data overview, operations reports, autopilot and visual styles.

## Decisions
Use a separate scoped admin management key, never broaden old import keys into publishing control. Analytics metrics remain read-only; creation/modification saves query presets. User clarification was requested; absent another answer the recommended query-preset interpretation was used. Autopilot API creation is paused and does not create jobs; activation is explicit and scheduled. Styles are per owner and frozen in future task payloads. No existing jobs were stopped or rewritten.

## Files changed
- Migration 0063; new psychology-management-api.js, psychology-managed-styles.js and tests; Worker route integration.
- Autopilot paging, optimistic revisions, idempotent creation and external current-scope guards.
- Photo creation, cloud/local renderer pipeline and browser gallery consume frozen custom style definitions.
- Shared API modal/CSS/guide in public; entry on four psychology pages.
- API reference, CURRENT_STATE and ARCHITECTURE.

## Validation
807 existing/new backend and rendering checks passed; separate local Chromium test of four entries also passed. Full final suite includes this browser test. All network publishing in tests is mocked; no live API keys rotated and no live plans enabled. Deployed guide provides exact endpoints and examples.

## Unfinished work
No requested implementation outstanding. Query presets are API-managed; raw analytic corrections were not assumed. Browser production smoke and deployment results are recorded in the final task response. No new official TikTok permission required.

## Recommended next step
Administrator opens API 接口, chooses read/write scopes and copies the guide for Grokbot. Start with reads and paused plans, then explicitly activate approved plans.
