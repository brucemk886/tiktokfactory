# Psychology photo/video analytics comparison — 2026-10-10

## Goal
Separate photo and video performance in Data Overview and Operations Report and make the same-date/group comparison immediately visible.

## Decisions
- Both standard report views show photo/video rows with publication count, synced/missing views, cumulative views, average views, high-view count/rate (>=1,000) and cumulative likes/comments/shares. Operations retains its existing photo/video tabs and cohort scope. The TikTok One view is independent.
- Overview additionally filters summary, anomaly and work-detail rows by all/photo/video/unknown. Its comparison retains both types; group/date and fresh module/account permissions constrain both populations.
- Cached official analytics often omit media type. Resolve it read-only through exact account + published video ID in ops_task_facts; conflicting identity evidence becomes unknown. Explicit provider type/photo URL can identify other posts; duration alone cannot. Never infer media from title or username.
- Preserve missing values as null, separate them from zero and exclude missing views from averages/high-view denominators. Unclassified posts stay visible as a separate row.
- Account-level profile visits, their ratio and Hub publication receipts remain explicitly labeled all types. Do not assign account traffic to a specific content type.
- Overview counts archived works; Operations counts Factory publication records. Both use Beijing publication dates and latest cumulative metrics, not daily view increments. No migration, analytics backfill, scheduled/publishing job mutation or provider publishing request.

## Files changed
- scripts/report-media.js and official-group-report.js: type evidence, nullable normalization, scoped comparison and filtering.
- factory-cloud/src/ops-report-store.js, official.js and psychology-report-query.js: read-only identity join and authorized comparison queries.
- public/official-group-report.* and psychology-operations.*; new report-media-comparison.css.
- Focused report/archive/query tests, desktop browser interaction test, first-paint CSS contract, package test entry and generated asset manifest.
- Current State and architecture notes.

## Tests performed
- 97 focused analytics/archive/authorization/detail regression tests passed.
- Desktop Chromium at 1440 x 1000: both pages, all/type filters, preserved comparison, stale requests, errors/retry, null/zero, non-psychology isolation, selected styling and no horizontal overflow. Screenshots inspected. No external publishing calls.
- Production read-only execution: today 31 video works / 8,132 views; near 7 days 825 photos / 149,395 views and 51 videos / 11,600 views. Combined counts 876 / 160,995 match the prior aggregate, with no unknown type in that observed window.
- Full Factory suite passed: 1,513 tests, zero failures/skips. Release verification pending below.

## Unfinished work
Complete guarded main deployment, then verify public assets.

## Recommended next step
Refresh Data Overview or Operations Report. Choose a date/group and compare photo/video rows; use the type selector/tabs for detailed investigation. Treat missing analytics as unavailable rather than zero.
