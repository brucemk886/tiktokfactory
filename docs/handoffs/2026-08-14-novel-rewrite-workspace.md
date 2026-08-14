# Novel rewrite workspace

Date: 2026-08-14

## Goal

Give operators a place to rewrite a novel's opening copy from the book list, and make that action correspond to novel effects and rewrite records.

## Decisions

- `/novel-library` rows now have 编辑 and 改写. 改写 opens `/novel-rewrite?novel=id`.
- `/novel-rewrite` saves a derived script under the selected novel. It does not overwrite the source chapter or parent script.
- `/rewrite-records` now includes manual book-list rewrites and official operation rewrites, tagged with the novel title and a link back to the rewrite page.
- Novel effects continue to aggregate those script versions after they are published and mapped.

## Files changed

- `public/novel-library.html` is unchanged except list actions in JS/CSS
- `public/novel-library.js`
- `public/novel-library.css`
- `public/novel-rewrite.html`
- `public/novel-rewrite.js`
- `public/novel-rewrite.css`
- `public/rewrite-records.html`
- `public/rewrite-records.js`
- `public/theme-ops.css`
- `scripts/novel-content-library.js`
- `scripts/novel-content-library.test.js`
- `scripts/server.js`
- `scripts/sidebar-modules.js`
- `scripts/sidebar-modules.test.js`
- `scripts/local-auth.js`
- `scripts/local-auth.test.js`
- `docs/CURRENT_STATE.md`

## Tests performed

- `node --test scripts/novel-content-library.test.js scripts/sidebar-modules.test.js scripts/local-auth.test.js`

## Unfinished work

- This page saves the rewritten script only. It does not generate ElevenLabs audio; official self-operation still does that after a diagnosed rewrite.

## Recommended next step

Restart Local Factory, open the book list, click 改写 on one novel, save a new opening version, then confirm it appears under 文案改写记录 and as a script version on that novel.
