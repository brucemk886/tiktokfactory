# Goal
Implement configurable automatic replies to user comments on a specified psychology video.

# Decisions
- 定时评论 includes account/video/topic selection, frozen A/B/C/D replies (1–150 characters each), explicit start, 48-hour default duration, per-video maximum, watch status, pause/resume and paginated per-comment logs.
- Topic bank edit/import supports separate replyOptions, with legacy PATCH preserving stored answers. No production topics or watches were enabled by implementation.
- Dedicated queue with five consumers; minute dispatcher handles up to 120 due watches. One official comment page per consumer, persisted cursor and 5-minute fresh traversal; pending replies advance by minute. One attempt per account/minute. Single watch per account/video; one durable item per target comment.
- Conservative explicit choice matching only; skip ambiguous, hidden, nested and owned comments. Hub checks target/account ownership. Same stable externalId on all recoveries; unknown receipts stop for review. Pause cannot retract an in-flight send.
- Explicit operator enrollment only; automatic attachment to future publishing batches is outside this specified-video flow. No AI-generated replies.

# Files
Migration 0040; psychology-auto-replies service/UI/tests; psychology-comments page; topic-bank normalizer/store/UI; index queue/scheduler routing; wrangler queue binding; architecture/current-state docs. Hub companion adds /api/v1/publish/comments/scan.

# Tests
538 factory tests passed, including 13 auto-reply cases for start windows, ownership, pagination, concurrency, account pacing, caps, skips, pause/expiry/revocation and unknown outcomes. Hub 254 tests/build and typecheck passed. No live replies sent.

# Next step
Ship hub scanner before factory UI/queue, then verify live UI and read-only/invalid-input smoke checks. User selects target video and confirms answer text before enabling a real watch.
