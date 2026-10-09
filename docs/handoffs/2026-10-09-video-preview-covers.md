# Video covers before playback — 2026-10-09

## Goal
Fix black default video cards in manual publishing, while keeping page operation responsive and preventing new cloud image accumulation.

## Decisions
- Existing video elements used preload=none without posters. A browser-only cover loader now seeks a separate muted decoder to min(0.5s, duration/2), captures a JPEG up to 360px and releases the media source. It never calls play to produce a cover.
- IntersectionObserver admits visible/near-visible cards (180px margin), with at most two decoders. Library and selected cards share URL-keyed object-URL covers, so selection/form rerenders do not refetch media. Cache trims to 40 entries excluding current card references; pagehide cancels pending work and revokes all object URLs, pageshow can restore previews.
- A cover/play button shows the frame without the native unloaded-player spinner; explicit click plays normally. Loading/error hints are bounded by a 15s timeout. Failed covers retain native playback and the refresh action retries failures.
- No cloud thumbnail files, uploads, persistent browser cache, schema changes, publication changes, new workers or planning activation.

## Files changed
public/psychology-video-posters.js (new), psychology-video-picker.js, psychology-publish-create.css; UI manifest; scripts/psychology-selected-ui.test.mjs; current state and this handoff.

## Tests performed
- Related publishing/UI/asset suite: 48/48 passed.
- Real Chromium flow verifies a decoded blue JPEG before any playback (pixel check), paused time=0, equal poster URLs and no extra video request after selection, click-to-play, account/caption/project publishing regressions, desktop/mobile layouts.
- A 12-video browser fixture checks only nearby cards are loaded, max two concurrent reads, error retains controls, retry recovers, cache reuse, pagehide release/pageshow restore, and zero publication requests from thumbnail work.
- Desktop and mobile cover screenshots inspected under primary tmp/video-posters-ui-captures. All media/accounts/publishing use isolated fixtures.

## Release evidence
Commit b2246c09023bf89ea6bedfead1fe0f2293f4d26f was pushed to main before deploying from a clean exact HEAD == origin/main release with npm run deploy. A temporary GitHub TLS preflight failure was retried through the same guarded command; deployment succeeded, Cloudflare version c75ae28f-0516-4b52-90df-6287c0ff6436. Live poster module, picker and CSS SHA256 matched the release; video-hit inventory and private video reads returned 401 without login. Existing video-transfer PID 100756 retained its original start time; no real publishing was performed.

## Unfinished work
Implementation, verification, deployment and read-only production checks complete. No unfinished work.

## Recommended next step
Reload the standalone video picker. Initial visible covers fill progressively without autoplay. Slow video metadata/range delivery can delay an individual cover; the form remains available. Existing private media and confirmed-publication cleanup remain the source of truth.
