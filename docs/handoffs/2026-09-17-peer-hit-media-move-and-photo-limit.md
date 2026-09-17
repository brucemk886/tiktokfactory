# Peer Hit Media Move And Six-Photo Limit

## Goal

Make the psychology peer-hit table easier to scan, allow administrators to correct video/photo classification, and cap all photo posts at six images.

## Decisions

- The table keeps publish time, removes the redundant Beijing label, and adds first import time. Both are rendered in `Asia/Shanghai`.
- Selected rows can be moved together with the toolbar button beside `爆款复刻`; the target follows the active tab. A database lock preserves the administrator's manual type when later grokbot imports update the same record.
- Photo source resolution, AI story parsing, manual photo selection and official publish validation all use a six-image maximum.
- Source posts with more than six images retain the first six in their original order.
- Copy and voice columns use narrower controls; the female option remains mapped to Lara server-side.

## Files changed

- `factory-cloud/migrations/0027_psychology_peer_hit_media_type_lock.sql`
- `factory-cloud/src/psychology-peer-hits-store.js`
- `factory-cloud/src/psychology-peer-hits.js`
- `factory-cloud/src/photo-publishing.js`
- `factory-cloud/src/tikhub-photo-source.js`
- `scripts/psychology-peer-production.js`
- `public/psychology-peer-hits.html`, `.js`, and `.css`
- `public/psychology-photo.html` and `.js`
- Focused tests and durable project-state documentation

## Tests performed

- `npm test` from `factory-cloud`: 338 passed, 0 failed.

## Unfinished work

- None expected after deployment verification.

## Recommended next step

- Move one known misclassified record in each direction online, then confirm later grokbot metric updates do not move it back.
