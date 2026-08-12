# Official TikTok publishing handoff boundary

## Final ownership

- Local Factory owns video generation, media upload, and creation of the Signal Desk publish batch.
- Once Signal Desk accepts the batch, Local Factory records `已提交发布中台`, marks the local task complete, and stops polling remote status.
- Signal Desk owns future scheduling, TikTok submission, status confirmation, retries, failures, and published video IDs.
- Daily analytics synchronization only imports videos that TikTok actually published.

## Signal Desk polling cadence

- Future scheduled tasks do not query TikTok before their scheduled time.
- After the task is due and is accepted by TikTok, status checks run after 60 seconds, another 60 seconds, then 120 seconds, and every 5 minutes thereafter until terminal handling.

## Verification

- `node --test scripts/auto-task-official.test.js`
- `node --check scripts/auto-task-manager.js`
- `node --check scripts/server.js`
- `node --check public/tasks.js`
