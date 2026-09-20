# Center cream content cards — 2026-09-20

## Goal
Match peer numbered psychology cards: title and body sit in the middle of the cream frame, not stuck to the top-left.

## Decisions
- `renderContentCard` uses the same vertical centering helper as black covers, and draws title/body `textAlign=center`.
- A single body paragraph no longer gets a `•` prefix; multiple bullets still do, as centered lines.
- Stock photo overlay covers stay top-anchored; this change is the cream text content pages used by photo-text auto-publish.

## Files changed
- `public/psychology-card-renderer.js`, `public/psychology-photo.js` (cache bust)
- `factory-cloud/src/psychology-module.test.js`, `docs/CURRENT_STATE.md`

## Tests performed
Psychology module renderer source tests.

## Unfinished work
Already-published posts are unchanged; new renders pick this up.

## Recommended next step
Ship factory.tiktokaitool.com and use the new layout on the next photo-text batch.
