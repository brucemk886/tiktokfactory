# Novel Library Catalog

## Goal

Replace the obsolete `/novel-library` redirect with a dedicated local novel catalog for the fields the operator needs: title, platform, free chapters, and promotion code.

## Decisions

- `/novel-library` is a real page again and no longer redirects to Reddit tasks.
- The catalog reuses `novel-content-library.json` instead of creating a second disconnected book store.
- Book records remain compatible with the existing script/audio hierarchy and AI context.
- The first version supports create, search, and edit. It does not add destructive deletion.
- The catalog is registered in the canonical sidebar as `novel-library`; legacy admin accounts are upgraded once and retain their other visibility choices.

## Files Changed

- `public/novel-library.html`
- `public/novel-library.css`
- `public/novel-library.js`
- `scripts/novel-content-library.js`
- `scripts/novel-content-library.test.js`
- `scripts/server.js`
- `scripts/sidebar-modules.js`
- `scripts/sidebar-modules.test.js`
- `scripts/local-auth.js`
- `scripts/local-auth.test.js`

## Tests Performed

- `git diff --check` passed for the affected files.
- UTF-8 source inspection confirmed the Chinese UI copy is intact.
- The local server restarted successfully and is listening on port 3010, which verifies that `server.js` and the imported novel content service load without a startup syntax error.
- Runtime HTTP smoke checks for `/novel-library`, `/novel-library.js`, and `/novel-library.css` correctly returned the protected `/login` redirect for an unauthenticated request.
- The focused sidebar, local-auth and novel catalog suites passed through a temporary mapped drive: 11 tests passed.
- Runtime migration verification confirmed the existing admin account receives `novel-library` in its visible module list.

## Unfinished Work

- Log in through the browser and create/edit one disposable book record to complete the authenticated UI smoke test.

## Recommended Next Step

Run `node --test scripts/novel-content-library.test.js`, restart the server during an idle window, and verify that the button on the novel script/audio page opens the catalog without redirecting to `/tasks`.
