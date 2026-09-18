# Goal

Split the authorized-account workspace into a Groups tab and a Projects tab so each page only shows the items it can move.

# Decisions

- Groups is the default tab. It lists accounts, filters by group, and moves selected accounts into a group.
- Projects lists groups, filters by project, and moves selected groups into a project.
- Creating and deleting projects or groups stays on `/tiktok-connections-organize`.

# Files changed

- `public/tiktok-connections.html`
- `public/tiktok-connections.js`
- `public/tiktok-connections.css`
- `scripts/tiktok-connections-ui.test.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test scripts/tiktok-connections-ui.test.js`
- `npm test` in `factory-cloud` (341 passed)

# Unfinished work

None after deployment.

# Recommended next step

Refresh `/tiktok-connections` and check both tabs.
