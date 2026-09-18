# Goal

Make AI generation and stock photos use the same per-image overlay copy as text cards: N images, N copy blocks, blank line starts the next image.

# Decisions

- Count is the number of images. Each index maps to one copy block from `splitContentCardBodies`.
- Stock may still overlay an optional title/subtitle on the first image only.
- AI overlay is optional: empty copy publishes the raw Z-Image results. Filled copy composites through a same-origin `/api/official-tiktok/generated-photos/file` proxy so canvas is not tainted by the Z-Image CDN.
- Stock requires at least as many selected/pasted photos as the chosen count; it no longer reuses one photo across slides.

# Files changed

- `public/psychology-photo.html`
- `public/psychology-photo.js`
- `public/psychology-text-card.js`
- `factory-cloud/src/photo-publishing.js`
- `factory-cloud/src/psychology-module.test.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test factory-cloud/src/psychology-module.test.js`

# Unfinished work

- Not deployed until this change is committed and `factory-cloud` `npm run deploy` is run.

# Recommended next step

Generate 3 AI images with 3 copy blocks and 3 stock photos with 3 copy blocks, then publish one of each.
