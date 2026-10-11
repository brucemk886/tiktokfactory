# Autopilot can publish Video Hits videos and mention receivers

## Goal
Let a psychology autopilot plan draw unused ready Video Hits videos and append the saved receiver CTA, without changing existing copy-library plans.

## Decisions
`content_source=video-hits` draws `selected-video` with `selection=recent` and `isAiGenerated=false`. `mention_receivers=1` sets `mentionReceiver` for that draw and for copy-library plans. Pool-matching plans still reject mentions. Video captions get the same frozen receiver snapshot as photo batches.

## Files changed
Migration 0090. `psychology-autopilot.js`, `psychology-video-hit-publishing.js`, `scripts/psychology-auto-publish.js`, autopilot test.

## Tests
`node --test src/psychology-autopilot.test.js src/psychology-video-library.test.js` passed.

## Unfinished
Production plans for the three 20-account groups are created after this migration is deployed.
