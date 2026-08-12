# Official publish daily result sync

- Added `scripts/official-publish-result-sync.js` as a standalone daily result-ingestion job.
- Default execution is 08:30 Asia/Shanghai. The hour and minute can be overridden independently with `OFFICIAL_PUBLISH_RESULT_SYNC_HOUR` and `OFFICIAL_PUBLISH_RESULT_SYNC_MINUTE`.
- Eligibility uses Beijing calendar dates: a task is first queried on the day after its planned publish date. Long-range scheduled tasks generate no premature online polling.
- Eligible records are grouped by Signal Desk batch ID. One batch request updates all matching local records by remote task ID or `externalRef`.
- Published tasks store `videoId`, `videoUrl`, `publishId`, actual publish time, detailed official video data, profile and comment-sync metadata.
- Video details that have not reached the hosted analytics database remain pending and retry on the next daily run. Non-terminal publish results also retry daily. Seven days without a terminal result becomes `needs_review`.
- The existing third-party TikTok analytics scheduler and GeeLark publish records were not changed.
- Added an administrator-only manual sync endpoint: `POST /api/official-publish-records/sync`.
- Signal Desk bridge requests are serialized at a 650 ms interval by default; override with `OFFICIAL_PUBLISH_RESULT_REQUEST_INTERVAL_MS` only after checking the bridge rate limit.
- Verification: 15 targeted Node tests passed, including calendar-date gating, future-schedule exclusion, batch grouping, video detail ingestion and existing official-publish record behavior.
