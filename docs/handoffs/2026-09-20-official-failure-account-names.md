# Official failure record account handles — 2026-09-20

## Goal
Display TikTok @usernames for pre-submission psychology failures, including historical photo records without remote batch receipts.

## Cause and decisions
Photo tasks omitted account snapshots. Their render handoff carried only the connection ID, while failure records read video-only publish.officialAccounts. Successful records later obtained names from remote receipts; failures before batch creation never did.
New psychology tasks retain a small authorized account snapshot in psychologyAutomation, preserved by the existing photo render handoff. Failure records use it, with the legacy video snapshot as fallback.
Official record reads fill missing handles by exact connection keys (including tiktok: archive prefixes), first from archived @labels then the live directory when needed. Existing handles, statuses and errors are preserved. Search runs after enrichment. Directory failures leave records available. Reads do not persist changes or requeue jobs.

## Files
- factory-cloud/src/psychology-auto-publish.js and psychology-publish-retries.js
- factory-cloud/src/official.js
- scripts/official-publish-records.js
- Matching official records and psychology automatic publishing tests

## Validation
44 focused tests passed: actual photo generation-to-render-to-failure handoff retains username; historical listing resolves handle before search without writes or job creation; prefixed connection keys work; names are not guessed from nicknames; existing confirmed handles and outcomes are retained. Diff check passed. No live publishing or generation used by tests.

## Remaining work / next step
Commit, push main, deploy through factory-cloud npm run deploy, then verify the historical failed row via a read-only browser check. Expired photo asset recovery is separate and remains outstanding from the previous diagnosis.
