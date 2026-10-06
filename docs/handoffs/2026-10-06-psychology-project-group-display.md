# Psychology project/account display cleanup

## Goal
Explain why legacy automation-group names remain and remove their misleading use as active operating strategy groups.

## Finding
Live project settings are enabled with enrollmentMode project: 187 eligible publishing accounts enrolled, zero excluded or blocked. Eleven existing delivery executors still retain authorization group names. They enforce existing permissions, timing and frozen reservations; their labels do not determine the project's account-data matching strategy. The UI still showed those names in conversion receiver labels, execution headings/comparisons and member details.

## Decisions
- Conversion receiver choices show account name and followers; account role details omit the old group column.
- Execution headings, comparison and anomaly lists identify affected accounts. Old authorization names stay under a closed original-authorization disclosure for tracing records.
- Original group-based creation/transition tools are explicitly folded as historical compatibility; project settings remains the primary entry point.
- No backend schedule, policy, account assignment, task, pause or publishing change is made. Existing delivery executors are preserved.

## Files changed
public/psychology-autopilot.html and .js, psychology-conversion.js, focused client tests and asset manifest; CURRENT_STATE and this handoff.

## Tests performed
130 focused UI/task-execution/conversion/asset regression tests passed. After rebasing on the concurrent independent-site funnel release, 64 joint UI/funnel/asset checks passed. Zero failures/skips; tests use synthetic/local data and never call real publishing APIs.

## Release
Runtime commit b8b1e5b9df4dd30d68eee9c334166222a7d16605 pushed to GitHub main. Clean main exactly matched origin/main before npm run deploy. Worker version 75dbf8ed-7cc5-445a-8b4c-b59c5961fd11 deployed to factory.tiktokaitool.com.

## Unfinished work
No requested presentation work remains. Authorization groups and executor storage continue to exist; deleting or replacing them would be a separate scheduling/permission migration and is not represented as completed here.

## Recommended next step
Manage enrollment in project settings, read current performance in the account/content views and use original authorization disclosures only when tracing historical execution.

## Production verification
Logged-in production UI showed receiver choices as account name + followers, execution headings as affected account names/counts, and comparisons as publication records/strategy. Original authorization disclosures and old-plan tools were closed by default. Project summary retained 187 enrolled/eligible, zero excluded/blocked. At 390 pixels, the expanded execution view remained within viewport width. Verification used read-only UI navigation and changed no account/policy/task data.

The live reviewer membership page returned twenty account rows with account/tier/state/effective-time columns and no legacy automation-group names. The owned browser session was closed.
