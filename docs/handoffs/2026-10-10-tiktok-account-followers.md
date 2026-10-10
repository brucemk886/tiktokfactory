# TikTok account follower counts

## Goal

Show each authorized account's follower count on the TikTok account list.

## Decisions

- The number comes from the already synced profile, using followers or followerCount.
- Unknown values stay blank. A real zero stays zero.
- The account directory query still does not load full profile JSON. Followers are attached with the existing scoped profile read.

## Files changed

- factory-cloud/src/official.js
- public/tiktok-connections.js
- public/tiktok-connections.css
- factory-cloud/src/ui-asset-manifest.js

## Tests performed

- Directory listing attaches a synced follower count.
- Account row rendering shows a count, a real zero, and a blank unknown value.

## Unfinished work

- None.

## Recommended next step

- Refresh the TikTok account page and confirm the follower column lines up with the latest sync.
