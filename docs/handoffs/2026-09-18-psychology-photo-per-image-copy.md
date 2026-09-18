# Goal

Generate one independent photo per click. Copy, title, and image are not shared across a batch.

# Decisions

- Removed count selectors and per-image field lists.
- Each mode is a single form: fill this image, click 生成这张, it appends to the album.
- Content title belongs to that one page. A later generate does not replace earlier cards.
- Album cap is 6 per mode, with a 清空图集 control.

# Files changed

- `public/psychology-photo.html`
- `public/psychology-photo.js`
- `public/psychology-photo.css`
- `public/psychology-text-card.js`
- `factory-cloud/src/psychology-module.test.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test factory-cloud/src/psychology-module.test.js`

# Unfinished work

- 图文爆款 recreation still needs to pick a template and fill this single-image form repeatedly.

# Recommended next step

On the live photo template, generate two content cards with different titles and confirm both stay in the album.
