# Goal
Reduce slow psychology autopilot page loading while the nine-group test continues.

# Evidence and decisions
Same logged-in browser before fix: initial refreshGroups=1 GET 11,889 ms; cache-directory GET 11,079 ms. Browser debug capture is unsupported by installed extension; browser resource timing and a bounded authenticated read provide the baseline. The primary code bottleneck was a serial per-pilot metadata/execution chain (nine pilots), plus redundant first-visit directory synchronization and full media/request payload reads.
Combine metadata reads into one D1 batch with per-pilot window limits; run slotExecution once across all selected pilots, and isolate items by exact batch IDs (different groups can have identical slot times). Project only fields needed for status/title/retry calculation. Preserve owner scope, receipt precedence, cleaned-job errors, retries, pause behavior and existing jobs. First visit/status refresh uses persisted directory; create dialog/manual group refresh/start still revalidate live directory. Missing cache still fetches it.

# Files
factory-cloud/src/psychology-autopilot.js; psychology-autopilot-execution.js; autopilot tests; public/psychology-autopilot.js/html; UI tests; CURRENT_STATE.

# Tests
730 passing. New regression covers same-time groups, different owners, per-pilot 12-slot/60-log windows, daily summaries and distinct publication outcomes, with two overview D1 batches after directory warm-up. No real publication from tests.

# Remaining
Commit/push main, deploy using npm run deploy; compare production browser timings and confirm nine pilots are intact. No active generation/publication job should be restarted or cancelled.
