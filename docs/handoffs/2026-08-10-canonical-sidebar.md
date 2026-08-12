# Canonical Sidebar Handoff

## Goal

Stop sidebar drift when modules are added and remove the stale-menu flash on authenticated pages.

## Decisions

- `scripts/sidebar-modules.js` is the only sidebar catalog.
- Authentication defaults, account administration, and browser rendering all consume that catalog.
- Every HTML page containing `.tasks-nav` or `.side-tabs` must load `/access.js`.
- Static HTML links stay as progressive fallback markup but remain hidden until the authenticated canonical renderer completes.

## Files Changed

- `scripts/sidebar-modules.js`
- `scripts/sidebar-modules.test.js`
- `scripts/local-auth.js`
- `scripts/server.js`
- `public/access.js`
- `public/accounts.js`
- `public/app.css`
- Legacy sidebar HTML pages now load `/access.js`.

## Tests

- Catalog uniqueness and role derivation.
- All sidebar pages load the canonical renderer.
- Browser code cannot redeclare a second sidebar catalog.
- Existing local authentication tests cover persisted per-account visibility.

## Unfinished Work

- Restart the local service after active generation and publishing jobs are idle so the API starts returning the canonical catalog.
