# Photo auto-publish: one copy-library source with a data-driven draw

## Goal
Replace the three photo sources (文案库原文 / 同行爆款 / 文案库改写) with one pool that draws originals and rewrites together and learns from published performance, original first.

## Decisions (approved thresholds)
- New sourceType `library`, photo only; selection is fixed to `evolve`. Old sourceTypes stay accepted for existing batches and video.
- Pool = completed photo originals (unusable >6-page originals skipped) + owner's enabled rewrites, grouped by source key. Rewrites without an extracted original form their own post.
- Account rule: never the same viral post twice in any version (usage row keyed by source key; legacy rows keyed by original id or rewrite id still block). `allowPeerReuse` lifts it.
- Version rule: original until 3 matured posts (24h + views); then 70% best average / 30% untested rewrites (fewest uses first); rewrites below 0.5× the original's average are retired from the draw.
- Post rule: 70% proven posts (best version average), 30% fresh posts (oldest import first), round-robin within a bucket so a batch spreads; one version once per batch, a taken original yields to its rewrites.
- Stats: `refreshCopyPerformance` rebuilds `psychology_copy_performance` (migration 0046) from the last 30 days on both daily crons (00:00 and 08:00 Beijing), matching items to archived views exactly like the content report. Items resolve to post/version from creative snapshots, falling back to rewrite rows or peer hits for older batches.

## Files changed
factory-cloud/src/psychology-copy-evolution.js (+ test), psychology-auto-publish.js, index.js, migrations/0046; scripts/psychology-auto-publish.js; public/psychology-auto-publish.{html,js}, psychology-publish-sources.js; factory-cloud/package.json; docs.

## Tests
Full factory suite 595/595. Strategy unit tests cover original-first, rewrite refill, 70/30 exploit/explore, winner, retirement, proven/fresh buckets, per-account and in-batch uniqueness, legacy usage mapping and the matured-only rollup. End-to-end: library batches draw originals, reserve posts by source key, never repeat a post per account, and refuse video.

## Unfinished / next
- Stats start empty until the first cron after deploy, so the first batches are all originals (intended).
- Per-account capacity equals the number of distinct viral posts, not versions; supply depends on new grokbot imports.
- Not shown in the UI yet: per-version stats on the copy library page, the A/B/C grade view.
