# TikTok official publish provider selection

Date: 2026-08-11

## Outcome

- Kept the existing GeeLark manual publishing path as the default.
- Added a second provider selector to the Reddit result publishing panel for TikTok official API testing.
- Added Local Factory server endpoints that list hosted authorized accounts and submit generated output videos to the hosted publishing hub.
- Official submissions upload the selected local video, create cross-product tasks for selected videos and accounts, split requests into batches of at most 100 tasks, and preserve the existing schedule/interval controls.
- The hosted hub copies one uploaded temporary asset into a dedicated object for every task before removing the temporary upload, so one video can safely fan out to multiple accounts.

## Boundaries

- This change affects the manual Reddit result publishing panel only.
- Existing GeeLark automation and task creation remain unchanged.
- A configured hosted bridge URL/API key is required in Local Factory.
- The hosted Worker changes must be deployed before testing multi-account reuse of a single uploaded video.

## Verification

- `node --test scripts/official-tiktok-analytics.test.js`: 4 tests passed.
- JavaScript syntax checks passed for `public/reddit.js`, `scripts/server.js`, and `scripts/official-tiktok-analytics.js`.
- TypeScript compilation of the hosted Worker could not be executed in the managed tool sandbox because Node was denied while resolving the repository path; run the normal hosted build/deploy script before production use.
