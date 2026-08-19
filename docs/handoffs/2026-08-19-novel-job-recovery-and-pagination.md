# Novel job recovery and hosted pagination

Date: 2026-08-19

## Goal

Restore the hosted novel-library/effects performance changes and prevent completed opening-rewrite jobs from losing their generated variants after a frontend timeout or refresh.

## Decisions

- Opening-variant job results are persisted as bounded bilingual variant records instead of being passed through the video-only result slimmer.
- The rewrite page queries the latest opening-variant job for the current user and novel from the previous 24 hours. It resumes queued/running jobs and restores completed results without generating again.
- Novel-library and novel-effects pagination stays at 20 cards per page.
- Hosted novel-effect reads keep summary-only novel rows, parallel independent reads, and slim result payloads.

## Files changed

- `factory-cloud/src/jobs.js`
- `factory-cloud/src/jobs.test.js`
- `factory-cloud/src/compat.js`
- `factory-cloud/src/novel-store.js`
- `factory-cloud/src/novels.js`
- `public/novel-rewrite.html`
- `public/novel-rewrite.js`
- `public/novel-library.html`
- `public/novel-library.js`
- `public/novel-library.css`
- `public/novel-effects.html`
- `public/novel-effects.js`
- `public/novel-effects.css`
- `scripts/novel-effect-core.js`
- `scripts/novel-effect-service.test.js`
- `docs/CURRENT_STATE.md`

## Tests performed

- `node --test factory-cloud/src/jobs.test.js scripts/novel-opening-styles.test.js scripts/codex-brain.test.js scripts/novel-effect-service.test.js`
- `npm test` from `factory-cloud`
- `node --check public/novel-rewrite.js`

## Unfinished work

- The one job completed before this fix needs its recovered Codex result written back through the worker completion endpoint after deployment.

## Recommended next step

Deploy the committed GitHub `main`, restore the recovered job result, then hard-refresh the hosted rewrite page and verify that all five variants reappear.
