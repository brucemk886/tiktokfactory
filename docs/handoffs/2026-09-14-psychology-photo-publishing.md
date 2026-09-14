# Psychology photo publishing

## Goal

Add an admin-only Psychology photo template that generates images with online Z-Image and sends a TikTok Business photo post through the existing official publishing hub.

## Decisions

- The workflow is cloud-only. It does not use the local rendering worker or local files.
- The user selects one Psychology-project account per submission and 1–35 generated images.
- Image order, cover index, title, caption, privacy, comments, schedule, automatic music, and a specific music ID are preserved.
- Factory Cloud imports only successful Z-Image results owned by the signed-in admin. The provider URL comes from D1, not request input.
- Imported images must be JPG or WebP, at most 20 MiB each.
- Factory Cloud forwards the ordered asset list to the main publishing hub; the hub calls the existing TikTok Business photo publishing queue.

## Files changed

- `public/psychology-photo.html`, `public/psychology-photo.css`, `public/psychology-photo.js`
- `public/psychology-templates.html`, `public/access.js`, `public/hub.css`
- `factory-cloud/src/photo-publishing.js`, `factory-cloud/src/signal-desk.js`, `factory-cloud/src/official.js`
- `factory-cloud/src/sidebar.js`, `factory-cloud/src/pages.js`, `factory-cloud/src/auth.js`
- `factory-cloud/src/psychology-module.test.js`

## Tests performed

- `node --check public/psychology-photo.js`
- `node --check factory-cloud/src/photo-publishing.js`
- `node --check factory-cloud/src/signal-desk.js`
- `npm test` from `factory-cloud`: 263 passed.
- A local browser screenshot was rendered with mocked read-only APIs; no publish call was made.

## Unfinished work

- The companion tiktokaitool.com publishing-hub change must deploy before this Factory Cloud page.
- Production should be smoke-tested with one generated image and a private test account before a public post.

## Recommended next step

Merge and deploy the tiktokaitool.com hub branch first, then merge and deploy this Factory Cloud branch.
