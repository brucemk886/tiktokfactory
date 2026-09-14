# Psychology peer hits row delete

## Goal
Let admins remove a saved psychology peer-hit video from the list.

## Decisions
- Only logged-in admins with `psychology-peer-hits` can `DELETE /api/psychology-peer-hits/psy-…`.
- External grokbot keys stay POST-only.
- Invalid ids return 400; missing rows return 404.

## Files changed
- `factory-cloud/src/psychology-peer-hits.js`
- `factory-cloud/src/psychology-peer-hits-store.js`
- `factory-cloud/src/psychology-peer-hits.test.js`
- `public/psychology-peer-hits.html|js|css`
- `docs/CURRENT_STATE.md`

## Tests performed
- `node --test factory-cloud/src/psychology-peer-hits.test.js`
- `factory-cloud` `npm test` before deploy

## Unfinished work
None for this change.

## Recommended next step
None.
