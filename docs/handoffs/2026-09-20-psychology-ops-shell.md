# Psychology module page shell

## Goal

Give every psychology sidebar page the same chrome, not only auto-publish / 题库 / 对标.

## Decisions

- `public/psychology-pages.css` is the module shell. Body class is `psychology-module`.
- Header is Chinese `h1` + lead. English kickers are removed from psychology HTML.
- Four-image, collage, and interactive templates switch from `tasks-sidebar` to the canonical `side-tabs`.
- `/psychology-effects` (shared `official-group-report.html`) adds `psychology-module` on that path only, so novel/mid-video reports stay unchanged.
- Account/video drilldowns with `?module=psychology` load the same shell via `official-analytics-shared.js`. Sidebar then highlights 数据概览.

## Files changed

- `public/psychology-pages.css` and psychology HTML/CSS listed in git
- `public/access.js`, `public/official-analytics-shared.js`, `public/official-group-report.html` / `.js`
- `scripts/server.js` serves `/psychology-pages.css`
- `factory-cloud/src/psychology-auto-publish.test.js`
- `docs/CURRENT_STATE.md`

## Tests performed

- `factory-cloud` `npm test`

## Unfinished work

- Retired `psychology-topics.html` is unchanged (410).
- Novel / mid-video / official-analytics chrome is unchanged.

## Recommended next step

Ship with `factory-cloud` `npm run deploy`, then open the psychology sidebar pages and confirm the header/sidebar match.
