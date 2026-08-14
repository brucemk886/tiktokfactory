# Novel library catalog views

Date: 2026-08-14

## Goal

Make `/novel-library` open on the book list. Show create/edit only after those actions. Surface two marks per novel, and keep featured/hit shelves separate for each platform.

## Decisions

- Default view is a spreadsheet-like catalog with platform tabs and three shelves: 全书库, 重点书单, 历史爆款.
- `featured` is a stored creation-time mark. Operators check it when creating or editing a book.
- `hit` is computed, not stored. Within each platform, novels with at least 200 matched views are ranked by total plays; the top 50 become that platform's historical hits.
- Create and edit replace the catalog instead of sitting beside it.
- Existing `novel-content-library.json` stays the only book store. No second catalog file.

## Files changed

- `public/novel-library.html`
- `public/novel-library.js`
- `public/novel-library.css`
- `public/theme-ops.css`
- `scripts/novel-content-library.js`
- `scripts/novel-content-library.test.js`
- `docs/CURRENT_STATE.md`

## Tests performed

- Focused `scripts/novel-content-library.test.js` after the catalog-mark change.

## Unfinished work

- Confirm in the logged-in browser that the list is the default view and that create/edit return to the catalog.
- Historical hits stay empty until a novel has matched publish/video plays on that platform.

## Recommended next step

Hard-refresh `/novel-library`, create one featured book, and check that it appears under that platform's 重点书单. Books with matched plays should appear under 历史爆款 with a `平台播放 Top N` label.
