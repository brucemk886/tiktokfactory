# Publish source missing 我方帖子 link — 2026-09-20

## Goal
Show the published TikTok URL on 发布对标 when Signal Desk later obtained `item_id` after the first `publish.completed` receipt.

## Decisions
- Photo publishes can complete without `item_id`. The hub fills it ~2 minutes later, but `(endpoint, event, task)` uniqueness blocked a second `publish.completed`. `@anhwg22` on `0918-测试-3` was this case (`item_id` `7686895626340076807` on the hub, empty `videoId` in factory).
- Listing hydrates missing IDs from `GET /api/v1/publish/batches/:id` and persists them.
- Hub now emits `publish.updated` when `item_id` is filled by status follow-up or catch-up match. Factory registers that event and reapplies the receipt.

## Files changed
- `factory-cloud/src/psychology-auto-publish.js`, `publish-webhook.js`
- `D:/cursor/tiktokaitool/lib/hub-webhooks.ts`, `tiktok-publish-queue.ts`, `publish-item-backfill.ts`, webhook routes
- docs and tests

## Tests performed
Factory auto-publish source hydrate + webhook receipt tests; Signal Desk source-match tests for `publish.updated`.

## Unfinished work
Existing hub endpoints still subscribe only to completed/failed until the factory daily verify re-registers.

## Recommended next step
Deploy factory then Signal Desk so the live `@anhwg22` row hydrates on the next 发布对标 load.
