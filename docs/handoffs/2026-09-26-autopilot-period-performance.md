# Autopilot effect metrics follow period — 2026-09-26

## Cause / goal
Execution date filters were added, but the comparison table still rendered latest.overview from the scheduler's most recent mature 7-day analysis. It could show historical median/potential rate on an unpublished today.

## Changes
The owner-scoped overview metadata batch now aggregates ops_task_facts for the selected actual publication dates, confirmed published state, and non-null views. Exact per-pilot median and >=1000 rate include today's synced works with no 24-hour wait. No sample returns n=0 and null metrics. UI uses only performance, never falls back to latest analysis. Missing values display —; real zero participates in statistics. Existing scheduler analysis, logs and decisions remain unchanged.

## Validation
756 tests pass, including yesterday/today/7d separation, no samples, same-day data, zero versus missing, unpublished exclusion, owner isolation and an explicit historical 495 / 7.1% UI regression. No real publishing calls.

## Release
Pending deployment and live verification.
