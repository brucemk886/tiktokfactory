# Goal
Show the nine-group automatic-operation run in operations reporting with group/A/B/C comparisons and same-day metrics.

# Evidence / decisions
The Beijing 2026-09-25 schedule has 360 planned posts. Final exact item/receipt status audit found 348 published, 5 failed + 1 needs_review, and 6 preparing. Earlier 360-published interpretation was incorrect; never equate planned count with success. The original main report filtered out posts under 24 hours and had no persisted pilot attribution. User explicitly requested same-day reporting; remove that gate from interactive overview/accounts/content/strategy comparisons, while leaving the automatic allocator's maturity policy unchanged.
Execution joins exact pilot slots, batches, items and receipts, scoped to authorized pilot groups and account memberships. No matching by username/title/ID prefix. Count by scheduled publication date, independent of receipt creation date and analytics availability. Current cumulative metrics from archived account/video identity feed group/strategy comparisons; missing values stay null. Earlier receipts are merged into the report's record inputs.

# Files
New scripts/psychology-autopilot-report.js; operations API/framework and their tests; psychology-operations HTML/JS and content-performance UI; current-state/architecture.

# Validation
739 full-suite tests passed. Covers 360 same-day tasks / nine groups / three strategies, 120 tasks per strategy; exact account/batch identity, duplicate rows, missing versus zero metrics, failed/submitted/stopped states, future-day exclusion. SQLite API test covers comma-separated batches, earlier receipts, unarchived members, manual-batch exclusion, media and authorized-group filters. Shared scheduling still uses mature samples. No live publishing tests or active-job changes.

# Sync cadence audit
Current hub main has recent-only refresh every two hours at UTC even hours :15 (Beijing 00:15,02:15,...22:15), limited to posts published in the most recent 24 hours; full daily refresh at UTC23:00 / Beijing07:00. Factory's 00:00/08:00 Beijing crons persist reports and copy-performance rollups, not the actual upstream TikTok polling cadence. Queue times are dispatch times, not completion guarantees.

# Release / remaining
Initial code291c8a6 committed/pushed main and deployed with npm run deploy (clean HEAD==origin/main); Worker c040f3fd-efe7-43d2-be81-a0a2285dc5cd. Production UI/API verified nine groups, 40 planned each, three strategies120 each; 348 published with synced metrics, current cumulative110509 views. Latest factory archive sync was2026-09-25 14:17:13 Beijing. First new report request16.178s (still not instant). Verified group1 filter:40 planned/38 published/one failure/one pending and exactly one group row. Final correction preserves known archive freshness despite zero-sync assigned members and labels failed/needs-review distinctly. Covered by a regression test. Browser screenshot capture timed out; rendered DOM and API values were verified at1440x1000.

Final code49b96d2 committed/pushed and deployed through clean-main npm run deploy, Workerfc467d0d-5876-4306-b5b9-928b33f553e2. Browser verified corrected failure/needs-review labels and known sync timestamp (group1 oldest12:16:30),40planned/38published/exactly one group row. Debug evidence saved to ignored work/autopilot-report-browser-evidence.json; agent session closed. No required work remains for this change. Active queue jobs and TikTok sync cadence were not changed.
