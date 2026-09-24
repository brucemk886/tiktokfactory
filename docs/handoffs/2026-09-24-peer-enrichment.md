# 爆款评论、题材、对标账号、播放回填

## Goal

Let grokbot supply the material Sonnet rewrites need, and let the factory prefer posts that are still gaining plays.

## Decisions

- New key-authenticated posts require `topics` (1–3 fixed ids) and `topComments` (0–20). Updates may omit fields already saved. Signed-in manual import stays optional.
- Comments and topics live on `psychology_peer_hits`. Generate-copy loads them into the Sonnet prompt; comments are reworded, not pasted.
- The same Bearer key may GET `{ watchAccounts, refresh, enrich }`. Watch accounts are managed from the copy-library API panel (max 100). Refresh is photo posts whose `metrics_at` is missing or older than 7 days.
- A metrics update stores the previous play count. Unjudged library draws, and the copy-library sort「还在涨的优先」, put posts that gained plays in the last 14 days first.
- The ops content tab summarizes the current photo period by topic. A post with several topics counts in each.

## Files changed

- `factory-cloud/migrations/0051_psychology_peer_enrichment.sql`
- `factory-cloud/src/psychology-peer-hits-store.js`, `psychology-peer-hits.js`, `psychology-copy-generation.js`, `psychology-creative.js`, `psychology-copy-evolution.js`, `psychology-copy-library.js`, `psychology-operations.js`
- `scripts/psychology-peer-topics.js`, `scripts/psychology-ops-framework.js`
- `public/psychology-peer-hits.js`, `psychology-copy-library.html`, `psychology-operations.html`, `psychology-operations.js`
- `docs/psychology-peer-hits-api.md`

## Tests performed

- Peer-hit import of topics/comments, rising play, watch list and GET worklist.
- Evolution draw prefers a rising fresh post.
- Existing peer-hit metric requirement messages stay the same when metrics are missing.

## Unfinished work

- Grokbot still has to be given the updated paste instruction and start sending comments, topics, and the weekly GET.
- Posts imported before this migration have empty topics and comments; they show up on `enrich` until backfilled.

## Recommended next step

Paste the updated grokbot instruction, add the peer accounts to the watch list, then have grokbot GET the worklist and backfill.
