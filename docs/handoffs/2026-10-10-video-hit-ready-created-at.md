# Video Hits ready-card creation time

## Goal

Show when each ready Video Hits version was created on its gallery card.

## Decisions

- The time is the recreation version's `created_at`, not the source import time or the last update.
- Display uses Asia/Shanghai, hour cycle 24. A missing or non-positive timestamp renders as —.
- Authorization groups, readiness filters and publishing links are unchanged.

## Files changed

- `factory-cloud/src/psychology-video-hit-ready.js`
- `public/psychology-video-hit-ready.js`
- `public/psychology-video-hits.css`
- `factory-cloud/src/ui-asset-manifest.js`
- Ready API and browser tests.

## Tests performed

- Ready inventory API test confirms `createdAt` matches the version row.
- Ready homepage browser test checks both cards' datetime values and Shanghai formatting, then continues through photo, video and One creation. Six tests passed.

## Unfinished work

None.

## Recommended next step

Confirm the time on the live ready gallery after deploy.
