# Official TikTok analytics local archive

## Outcome

- Added an admin-only Local Factory page at `/official-analytics`.
- Added a daily 08:30 Asia/Shanghai archive job.
- The archive stores indexed SQLite history under `<workDir>/official-tiktok-history/official-history.sqlite` and never deletes older dates.
- With the current `config.json`, the actual destination is `D:/localcodex/work/official-tiktok-history/official-history.sqlite`.
- Each run archives every authorized account and up to its latest 100 official TikTok videos, preserving complete profile/video payloads for future analysis.
- Account/day and video/day are separate indexed rows. A same-day rerun upserts the same rows instead of appending duplicates.
- Existing `YYYY-MM-DD.json` files are imported once on startup and remain untouched as backups; new syncs write SQLite only.

## Online retention

- Signal Desk operational cleanup now retains official account/video daily snapshots for 30 days by default through `OFFICIAL_SNAPSHOT_RETENTION_DAYS`.
- Local Factory remains the long-term history store.

## Verification

- `node --check` passed for the server, archive service, and browser module.
- SQLite archive and legacy-import tests pass.
- Signal Desk rendered/architecture tests: 20 passed.

## Operation

- Restart Local Factory once to load the scheduler and new sidebar module.
- The first start after 08:30 performs a catch-up archive after about 15 seconds when today's snapshot is absent.
