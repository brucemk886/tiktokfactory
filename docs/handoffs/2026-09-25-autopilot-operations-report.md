# Goal
Show the nine-group automatic-operation run in operations reporting with group/A/B/C comparisons and same-day metrics.

# Evidence / decisions
Live receipt query confirmed all 360 posts for the Beijing 2026-09-25 schedule are published. The original main report filtered out posts under 24 hours and had no persisted pilot attribution. User explicitly requested same-day reporting; remove that gate from interactive overview/accounts/content/strategy comparisons, while leaving the automatic allocator's maturity policy unchanged.
Execution joins exact pilot slots, batches, items and receipts, scoped to authorized pilot groups and account memberships. No matching by username/title/ID prefix. Count by scheduled publication date, independent of receipt creation date and analytics availability. Current cumulative metrics from archived account/video identity feed group/strategy comparisons; missing values stay null. Earlier receipts are merged into the report's record inputs.

# Files
New scripts/psychology-autopilot-report.js; operations API/framework and their tests; psychology-operations HTML/JS and content-performance UI; current-state/architecture.

# Validation
738 full-suite tests passed. Covers 360 same-day tasks / nine groups / three strategies, 120 tasks per strategy; exact account/batch identity, duplicate rows, missing versus zero metrics, failed/submitted/stopped states, future-day exclusion. SQLite API test covers comma-separated batches, earlier receipts, unarchived members, manual-batch exclusion, media and authorized-group filters. Shared scheduling still uses mature samples. No live publishing tests or active-job changes.

# Sync cadence audit
Current hub main has recent-only refresh every two hours at UTC even hours :15 (Beijing 00:15,02:15,...22:15), limited to posts published in the most recent 24 hours; full daily refresh at UTC23:00 / Beijing07:00. Factory's 00:00/08:00 Beijing crons persist reports and copy-performance rollups, not the actual upstream TikTok polling cadence. Queue times are dispatch times, not completion guarantees.

# Release / remaining
Pending commit, push, deployment and live validation.
