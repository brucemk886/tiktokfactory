# Psychology photo template layout

## Goal

Default the photo template away from “no text in image”, and make the page a two-column generate / publish layout.

## Decisions

- `noImageText` starts unchecked; operators can still opt in before generating.
- Left column is prompt, controls, and the album; right column is account and publish settings.
- Keep the existing Z-Image → official photo-publish flow and element IDs.

## Files changed

- `public/psychology-photo.html`
- `public/psychology-photo.css`
- `factory-cloud/src/psychology-module.test.js`
- `docs/CURRENT_STATE.md`

## Tests performed

- `node --test factory-cloud/src/psychology-module.test.js`
- Browser check of `/psychology-photo` layout and default checkbox

## Unfinished work

None for this change.

## Recommended next step

Deploy when asked.
