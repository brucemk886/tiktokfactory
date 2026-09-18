# Goal

Let the psychology photo template make carousel slides without generating images: plain text cards, or stock photos with overlaid copy.

# Decisions

- Text cards are HTML/canvas typesetting exported as JPEG.
- Stock overlays search Pexels with the server-only `PEXELS_API_KEY`, always in portrait, and drop photos that look like they contain people.
- The photo template exposes three options in this order: AI generation, Pexels stock, then text cards. Publish still uses the official photo batch, first slide as cover.
- New slides upload through `/api/official-tiktok/photo-assets/upload` because they are not Z-Image generation records.

# Files changed

- `public/psychology-photo.html`
- `public/psychology-photo.js`
- `public/psychology-photo.css`
- `public/psychology-text-card.js`
- `public/psychology-templates.html`
- `factory-cloud/src/photo-publishing.js`
- `factory-cloud/src/psychology-module.test.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test factory-cloud/src/psychology-module.test.js`
- `npm test` in `factory-cloud`

# Unfinished work

- `PEXELS_API_KEY` is stored as a Cloudflare secret and in gitignored `factory-cloud/.dev.vars`. It must not be committed.

# Recommended next step

After deploy, confirm the photo template shows AI生图 / 素材库图片 / 文案图片, and Pexels search returns portrait empty scenes.
