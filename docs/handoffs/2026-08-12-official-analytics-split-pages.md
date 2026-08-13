# Official analytics split pages

## Goal

- Rename the administrator sidebar entry to `授权账号`.
- Replace the combined official analytics dashboard with focused account and video views matching the hosted Signal Desk information architecture.

## Decisions

- `/official-analytics` is now the authorized-account list and summary only.
- `/official-account-detail` owns the selected account metrics and playback-history chart.
- `/official-account-videos` owns the selected account's latest archived videos.
- `/official-video-detail` owns one video's current metrics and historical playback chart.
- All four views reuse the existing `/api/official-analytics` response and the same SQLite archive; no data model or synchronization behavior changed.
- Official subroutes map back to the `授权账号` sidebar item so navigation remains visibly grouped.

## Files changed

- `public/access.js`
- `public/official-analytics.html`
- `public/official-analytics.js`
- `public/official-analytics.css`
- `public/official-analytics-shared.js`
- `public/official-account-detail.html`
- `public/official-account-detail.js`
- `public/official-account-videos.html`
- `public/official-account-videos.js`
- `public/official-video-detail.html`
- `public/official-video-detail.js`
- `scripts/server.js`
- `scripts/sidebar-modules.js`
- `scripts/sidebar-modules.test.js`
- `scripts/official-analytics-ui.test.js`

## Verification

- JavaScript syntax checks for the four page controllers and shared helper.
- Focused sidebar, UI, and archive tests.
- `git diff --check`.

## Operational note

- Restart Local Factory before expecting the new routes and sidebar label to appear.
- No browser automation, synchronization call, server restart, or publishing action was performed.
