# Shared copy library for psychology production

## Goal
Make the accumulated viral copy and rewrite versions the source for future photo and video production. Content classification tags are deferred.

## Decisions
- Preserve the existing automatic extraction-on-peer-import pipeline and completed-only library. No historical backfill or new external calls.
- Both output modes offer completed originals (default) and enabled owned rewrites, plus existing peer/topic sources.
- Original video/photo filtering is independent of production format. Photos reuse stored text as cards; video templates still generate scripts/scenes/narration.
- Preserve immutable source/version snapshots, account reuse reservations, 20-post groups and idempotent creation.
- Reject originals requiring more than six photo pages or 5000 video-input characters before writes. Topic reveal comments keep requiring topic-bank data.

## Files
psychology-copy-source.js; cloud and shared psychology-auto-publish modules; auto-publish, copy-library and publish-sources UI; source and UI tests; current state, architecture and creative docs.

## Validation
576 factory tests passed. Includes all four original/output media combinations, enabled/owner filtering, pending exclusion, no repeated external extraction, exact snapshots after source edit/replay, no writes for oversized content, UI source submission and controls restored after submit. Corrected a preexisting double-mocked Math.random test leak. Headless Chrome verified actual select switching, text template selection and no page errors with synthetic APIs; no real posts submitted.

## Unfinished / next
No tags or historical extraction requested. Check live selectors after deployment; future work may expand video-specific performance reporting (current creative comparison remains photo-based).
