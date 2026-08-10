# Novel Audio Performance Selection

## Goal

Make Novel AI Operations use observed audio performance when creating Reddit generation tasks.

## Decisions

- Aggregate matched novel videos by source audio, including samples, account spread, average and median views, low-200 rate, over-1000 rate, and prior-window trend.
- Prioritize consistently strong audio, downgrade consistently weak audio when alternatives exist, and retain about one-third exploratory selections for unseen or insufficiently sampled audio.
- Persist the feedback with each operation plan and show the top audio results in the plan UI.
- Pass the selected audio priority list into the existing Reddit task payload; no GeeLark publishing behavior changed.

## Files Changed

- `scripts/operation-brain.js`
- `scripts/auto-task-manager.js`
- `scripts/reddit-mix-job.js`
- `scripts/operation-brain.test.js`
- `public/operator.html`
- `public/operator.js`
- `public/operator.css`
- `docs/CURRENT_STATE.md`

## Tests Performed

- `node --check scripts/operation-brain.js`
- `node --check scripts/reddit-mix-job.js`
- `node --test scripts/operation-brain.test.js scripts/auto-task-manager.test.js`

All 16 tests passed.

## Unfinished Work

- Existing queued tasks keep their original payload and are intentionally not rewritten. The new selection applies to newly generated Novel AI plans.

## Recommended Next Step

Generate one review-only Novel AI plan after enough new audio/video matches exist, confirm the displayed ranking, then approve it when the selected audio mix looks right.
