# Official analytics layout and account history controls

## Goal

- Hide the local SQLite archive path from the official TikTok analytics page.
- Make the official data overview easier to scan and consistent with the GeeLark overview.
- Clearly distinguish GeeLark pages in the sidebar.
- Let account playback history select an account directly and use an independent time range.
- Rename the official entry to `官方账号数据和视频数据`.

## Decisions

- Keep account metrics as the primary table, followed by account history, the selected account's video table, and selected-video history.
- Do not draw a trend area when only one daily snapshot exists; show the current snapshot and explain that a second day is required.
- Prefix the legacy analytics and publish pages with `GeeLark ·`.
- Keep the page-level date range for video history and send a separate `accountDays` range for account history.
- Changing the account-history dropdown also changes the selected account and its video list so the page stays internally consistent.

## Files changed

- `public/official-analytics.html`
- `public/official-analytics.js`
- `public/official-analytics.css`
- `scripts/official-analytics-archive.js`
- `scripts/server.js`
- `scripts/sidebar-modules.js`
- `scripts/sidebar-modules.test.js`
- `scripts/official-analytics-ui.test.js`
- `scripts/official-analytics-archive.test.js`

## Verification

- `node --check public/official-analytics.js`
- `node --check scripts/official-analytics-archive.js`
- `node --test scripts/sidebar-modules.test.js scripts/official-analytics-ui.test.js scripts/official-analytics-archive.test.js`
- `git diff --check`
- The archive test verifies that `days=1` can return one day of video history while `accountDays=30` still returns the full account history window.

## Operational note

- Restart the Local Factory server before expecting the new API query and sidebar catalog label to take effect.
- No server restart or browser automation was performed to avoid interrupting active generation or publishing work.
