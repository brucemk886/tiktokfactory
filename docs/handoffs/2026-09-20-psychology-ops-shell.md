# Psychology ops page shell

## Goal

Give 心理学自动发布, 模板题库, and 发布对标 one shared page chrome so they stop looking like three unrelated analytics copies.

## Decisions

- New `public/psychology-pages.css` is the ops-page shell: header, column padding against the 236px sidebar, panels, related-page chips, pagination buttons.
- Header is Chinese `h1` + `page-lead` + `page-links`. English kickers (`PSYCHOLOGY / AUTOMATION`, `SOURCE TRACE`, `01 / CONTENT`, `QUEUE`) are gone.
- Those three pages no longer load `official-analytics.css`. Auto-publish keeps its two-column queue.
- 运营报表 and the photo/collage workbench stay on their existing shells.

## Files changed

- `public/psychology-pages.css`
- `public/psychology-auto-publish.html` / `.css`
- `public/psychology-topic-bank.html`
- `public/psychology-publish-sources.html`
- `public/theme-ops.css`
- `factory-cloud/src/psychology-auto-publish.test.js`
- `docs/CURRENT_STATE.md`

## Tests performed

- `factory-cloud` `npm test` after the HTML/CSS change.

## Unfinished work

- `/psychology-ops-report` still uses the official-data-header kicker.
- Template workbench pages still use `module-pages.css`.

## Recommended next step

Ship with `factory-cloud` `npm run deploy`, then open the three live pages and confirm the header/links match.
