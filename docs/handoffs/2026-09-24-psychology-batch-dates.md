# Psychology batch creation-date filtering and pagination

## Goal
Explain disabled next-page button and add date filtering to automatic publishing.

## Decisions
- Current seven batches fit one ten-batch page. Disabled Next is correct; footer now explicitly displays current/total pages, total batches, page size and last-page hint.
- Add All / Today / Yesterday / 7 days / 30 days / Custom over batch creation time in Beijing time. End date is inclusive through the next midnight exclusive.
- Filter both SQL count and rows before LIMIT/OFFSET with bound parameters and existing owner/attention scope.
- Changing dates resets page one; pagination preserves applied dates. Custom drafts apply only after valid date range + Query. Requests disable pagination; stale responses ignored and page changes commit only on successful response. Out-of-range pages clamp after count changes.
- No rendering, retries or publishing triggered.

## Files
- factory-cloud/src/psychology-auto-publish.js and .test.js
- public/psychology-auto-publish.js/.html/.css
- scripts/psychology-auto-publish-ui.test.js

## Validation
- Focused suite 78 passed: timezone boundaries, invalid dates, owner scope, count before pagination, cross-page filter persistence and custom query validation.
- Full suite 642 passed including concurrent unrelated workspace changes; owned files will be shipped from a clean checkout.

## Unfinished
- Deployment/live verification pending.
