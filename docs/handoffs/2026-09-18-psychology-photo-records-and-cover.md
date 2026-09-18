# Goal

Keep cover and content text cards in the same album, and write psychology photo submits into factory official publish records.

# Decisions

- Regenerating a content page replaces only content slides. An existing cover stays, and covers sort first so the first ticked image is the cover.
- `/api/official-tiktok/photo-publish` writes `photo:{requestId}` with `externalRef={requestId}:0` so Signal Desk receipts can attach without the local worker.
- Official records can open TikTok `/photo/` links.

# Files changed

- `public/psychology-photo.js`
- `public/psychology-photo.html`
- `public/psychology-text-card.js`
- `public/official-publish-records.js`
- `factory-cloud/src/photo-publishing.js`
- `factory-cloud/src/psychology-module.test.js`
- `docs/CURRENT_STATE.md`
- `docs/PIPELINE.md`

# Tests performed

- `node --test factory-cloud/src/psychology-module.test.js`

# Unfinished work

- The 2026-09-18 `i can fix her` post was submitted with one image because the cover was cleared before publish. Re-generate cover + content after deploy to post both.

# Recommended next step

After deploy, confirm official publish records show new photo submits, and generate cover then content without losing the cover.
