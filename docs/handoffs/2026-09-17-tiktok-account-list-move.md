# Goal

Let operators move authorized TikTok accounts into a project/group on the account list page, and stop asking them to do that on the create-project page.

# Decisions

- Account checkboxes, “select this page”, and “move into group” now live on `/tiktok-connections`.
- Moving a whole group into another project also stays on the account list page.
- `/tiktok-connections-organize` only creates or deletes projects and groups. It no longer lists accounts or offers a move-account form.

# Files changed

- `public/tiktok-connections.html`
- `public/tiktok-connections-organize.html`
- `public/tiktok-connections.js`
- `public/tiktok-connections.css`
- `public/theme-ops.css`
- `scripts/tiktok-connections-ui.test.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test scripts/tiktok-connections-ui.test.js`

# Unfinished work

- Production still serves the previous HTML until `factory-cloud` is deployed.

# Recommended next step

Open `/tiktok-connections`, select a few accounts, move them into a group, then confirm the organize page no longer shows the account list.
