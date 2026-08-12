# Remove Local Single-Video Data Page

## Goal

Remove the Local Factory single-video data inspection page and its local HTTP surface without affecting aggregate analytics or Novel AI Operations.

## Decisions

- Removed the page, sidebar injection, account-list deep link, static routes, and page-only API routes.
- Kept the official bridge account listing and batch video reader because Novel AI Operations uses them for private retention and engagement analysis.
- Removed the page-only `getVideoDetail` service method.

## Files Changed

- `public/access.js`
- `public/tiktok-connections.js`
- `public/tiktok-connections.css`
- `scripts/server.js`
- `scripts/official-tiktok-analytics.js`
- `scripts/official-tiktok-analytics.test.js`
- `docs/CURRENT_STATE.md`
- Deleted `public/tiktok-video-detail.html`, `public/tiktok-video-detail.js`, and `public/tiktok-video-detail.css`

## Tests Performed

- JavaScript syntax checks for changed runtime files.
- Official bridge, local authorization, and operations-brain focused tests.
- Repository search confirming the removed page and routes have no remaining references.

## Unfinished Work

- None for this removal.

## Recommended Next Step

Restart Local Factory when convenient so the running server stops serving the removed routes.

## Follow-up: Canonical Sidebar

- All authenticated pages now rebuild their sidebar from one canonical module list in `public/access.js`.
- The canonical list is filtered by the current user's role and saved sidebar visibility settings, so navigating between pages no longer changes menu contents or ordering.
- The visible module name `TikTok 官方账号` was shortened to `TikTok 账号` without changing its route or permission ID.
