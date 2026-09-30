# Psychology adaptive generation and next-day admission

## Goal

Replace fixed two-hour preparation with demand/backlog-based generation. User explicitly capped preparation at three hours, requested new project accounts start from the next Pacific operating day, and limited account/planning/capacity checks to three per day.

## Decisions

- New scheduled photo tasks use adaptive-v1: minimum two hours, maximum three, 15-minute rounding. Forecast all participating owner/group accounts, current item jobs and other shared cloud work. Exclude ready/frozen/cancelled work and avoid counting source+render twice. Latest 200 successful render services over seven days supply P95; fewer than 20 samples retains a five-minute floor. Use ten effective consumers and 45-minute buffer. Uncapped required time and insufficient-lead warnings remain visible; this is a conservative planning estimate, not a throughput guarantee.
- Preserve 26-hour reservation horizon, existing Pacific 08:00/11:30/20:00 rounds and offsets, content eligibility, account daily claims and frozen publication times. New source rows get an atomic generation-plan record; defer Workflow creation until due. At Pacific 05:00/08:30/17:00, account admission, planning and untouched generation times are checked once per round; start times may advance, never delay. The old twice-daily heavy maintenance no longer calls automatic planning. Minute dispatch uses leases and stable idempotent Workflow IDs. Existing legacy workflows are not restarted or migrated.
- Start claims recheck cancellation atomically. Running/retried/dispatched/child-created/uploaded/submitted work is never retimed. Initial payload records history; the generation-plan table is authoritative for the current planned start shown in details.
- Preserve actual assignment timestamps when unrelated accounts are saved. Actual account group or group-project moves preserve a truthful binding timestamp; renames and unrelated saves do not rewrite it. Assignment changes do not trigger extra scans. New memberships use nextDay(bindingAt, project timezone), bounded by cycle start and the account's own frozen legacy work. This avoids an additional day when discovery crosses midnight. Future existing slots may add missing accounts without recreating existing items. A durable round claim prevents concurrent/repeated checks; missed/failed checks wait for the next scheduled round. Existing minute machinery starts due generation jobs and does not scan account membership outside the three daily check windows.
- Capacity on the page is the owner-scoped snapshot written by the three operating checks. GET/automatic page refresh reads that snapshot and does not rescan the production queue; before the first check, the page explains the pending snapshot.
- Automatic operating cycles remain seven days with three-day reviews; this change does not renew an ended cycle or override missing qualified content.

## Files changed

- Migration 0073, psychology-production-capacity and psychology-adaptive-production modules/tests.
- Auto-publish atomic creation, peer-photo Workflow gate, due dispatch and three-check clock gate in index.js/psychology-production-checks/tests.
- Autopilot forecasts/detail API and task-group next-day admission/tests.
- Official assignment/group-project binding timestamp persistence/tests.
- Autopilot HTML/JS/UI tests and generated asset manifest.
- CURRENT_STATE and ARCHITECTURE.

## Validation

Focused queue, source Workflow, scheduling, UI and admission tests cover caps, cross-owner demand, delayed replies, cancellation races, replay, explicit retry, midnight/DST admission, supplementary future slots and preserved historical work. Final factory-cloud npm test: 1,096 passed, 0 failed. Asset manifest and git diff checks passed. Production verification is recorded below after release. Tests use SQLite and mocked provider/publishing endpoints; no live publishing test was run.

## Deployment and verification

Final regression passed. Pending clean main push, factory-cloud npm run deploy and read-only production verification. No production task run, pause, cancellation or account binding was triggered manually during validation.

## Unfinished work / next step

No requirement is intended to remain unfinished. Monitor actual service samples and capacity warnings after the October 2 cycle begins; cap stays three hours even when predicted demand exceeds it. New/weak accounts still wait if matching lacks qualified content. Production release checks follow below.
