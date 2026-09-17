# Dynamic Psychology Photo Recreation

## Goal

Make psychology photo-hit recreation preserve the original TikTok post's image count and order instead of always generating six pages.

## Decisions

- Use ordered image URLs already stored in `videoData` when available; otherwise resolve the TikTok photo link with the server-only TikHub credential.
- Accept only HTTPS image URLs on known TikTok CDN domains and cap a post at the official publishing limit of 35 images.
- Send all ordered source images to Kie Gemini 3.8 Flash in one multimodal request. Gemini rewrites the psychology copy and returns one analyzed scene per source image.
- Generate one Z-Image result per returned scene. A one-image source therefore creates one rewritten scene and one replacement image.
- Keep image text as separate page copy; Z-Image prompts reserve the source layout's text area but do not ask the image model to render words.

## Files changed

- `scripts/psychology-peer-production.js`
- `factory-cloud/src/kie.js`
- `factory-cloud/src/tikhub-photo-source.js`
- `factory-cloud/src/peer-photo-workflow.js`
- `factory-cloud/src/psychology-peer-production.js`
- `public/psychology-peer-production.js`
- Focused tests under `factory-cloud/src/`

## Tests performed

- Targeted TikHub photo, TikHub video, Kie, peer production, peer-hit and psychology publishing tests.
- Full `factory-cloud` test suite: 332 passed, 0 failed.

## Unfinished work

- Production D1 had no saved `photo` peer-hit rows at implementation time, so an actual TikTok photo post still needs an operator smoke test after one is imported.

## Recommended next step

Import one single-image and one multi-image TikTok photo post, run `爆款复刻`, and confirm the review board shows exactly 1 and N generated images in the original order.
