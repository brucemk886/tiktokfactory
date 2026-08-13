# Official analytics full-detail parity

## Completed

- Preserved full account insight objects in each daily account snapshot.
- Expanded account detail with profile metrics plus gender, age, country/region, city and audience-activity distributions.
- Kept an explicit all-videos entry from account detail.
- Expanded account videos with cover, caption, video ID, publish time, duration, engagement, watch-time, completion and reach.
- Expanded video retention detail with all stored video metrics, traffic source, audience country/gender/city/type, remaining primitive API fields and second-by-second retention.
- Added a daily video-play history chart sourced from independent video snapshot rows.
- Retention uses the hosted nonlinear timeline convention: the first ten seconds occupy half of the chart, and later seconds occupy the remaining half.

## Verification

- JavaScript syntax checks passed for shared, account, video-list and retention controllers.
- Official archive and UI tests: 9 passed.
- `git diff --check` passed (one existing CRLF notice for `scripts/server.js`).

## Data note

- Audience and retention sections show only fields actually returned by TikTok and archived by the daily bridge sync.
- Daily change charts require at least two snapshots; a single snapshot is shown as a current-value placeholder rather than a misleading curve.
