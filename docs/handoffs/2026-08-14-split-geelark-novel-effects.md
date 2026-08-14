# Split GeeLark novel effects

Date: 2026-08-14

## Goal

Keep official novel effects on the novel-promotion line. Move the GeeLark third-party novel-effects view into the GeeLark backup group so the two data channels are no longer toggled on one page.

## Decisions

- `/novel-effects` is locked to `official_api`.
- `/geelark-novel-effects` is a separate admin page under `geelark-backup`.
- Both pages reuse `novel-effects.js` and `novel-effects.css`; the source is fixed by `data-source` on the page body.
- Existing admins receive the new sidebar module once through local-auth store version 12.

## Files changed

- `public/novel-effects.html`
- `public/geelark-novel-effects.html`
- `public/novel-effects.js`
- `public/novel-effects.css`
- `public/hub.html`
- `public/hub.js`
- `scripts/sidebar-modules.js`
- `scripts/sidebar-modules.test.js`
- `scripts/local-auth.js`
- `scripts/local-auth.test.js`
- `scripts/server.js`
- `docs/CURRENT_STATE.md`

## Tests performed

- `node --test scripts/sidebar-modules.test.js scripts/local-auth.test.js`

## Unfinished work

- Reddit auto-publish (`/tasks`) still offers GeeLark as a publish provider because official API publish shares that page.

## Recommended next step

Restart Local Factory, hard-refresh `/novel-effects`, and open `GeeLark · 小说效果` from the backup group to confirm the two pages no longer share a source toggle.
