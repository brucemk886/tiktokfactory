# Official API Local Publish Records

Date: 2026-08-12

## Outcome

- Added an administrator-only `/official-publish-records` page in Local Factory.
- The page reads only local records whose provider/source is TikTok official publishing.
- Existing `/stats` publishing records now exclude official handoffs and remain focused on GeeLark/local publishing.
- Official records preserve the Local Factory task, TikTok account, video file, planned publish time and Signal Desk batch identifiers.
- The Local Factory page labels accepted records as `已提交发布中台`; final scheduling, publishing, retries, status and TikTok video IDs remain owned by Signal Desk.

## Compatibility

- Historical official records already stored in `publish-records.json` are classified at read time; no destructive data migration is required.
- Analytics code can continue reading the combined storage file, so existing video-to-local-asset matching is preserved.
- Existing administrator sidebar configuration receives the new module through store migration version 7. Operators do not receive it.

## Verification

- Focused Node tests cover provider classification, official-record IDs, official publishing persistence, sidebar visibility and auth migration.
- Node syntax checks cover the server, task manager, record helper and new browser script.
