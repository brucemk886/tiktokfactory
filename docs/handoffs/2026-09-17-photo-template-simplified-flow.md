# Photo Template Simplified Flow

## Goal

Remove the redundant image-selection step and compact the photo-post creation form.

## Decisions

- A newly generated batch is published in generation order, capped at six images, with image one as the cover.
- A peer-recreation album keeps its existing source/result order and also uses image one as the cover.
- On a normal reload, the latest six successful Z-Image results are used automatically.
- The image prompt and caption fields use a compact height, and visibility is the final item in the three-column settings row.

## Files changed

- `public/psychology-photo.html`
- `public/psychology-photo.js`
- `public/psychology-photo.css`
- `factory-cloud/src/psychology-module.test.js`
- `docs/CURRENT_STATE.md`

## Tests performed

- `npm test` from `factory-cloud`: 338 passed, 0 failed.

## Unfinished work

- None expected after deployment verification.
