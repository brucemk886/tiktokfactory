# Video Hits independent import-source identities

## Goal
Allow different importing agents to keep independent material for the same original video identifier, including agents sharing one project API key. The user explicitly requested support for different sources rather than global merging.

## Decisions
- Source uniqueness is owner_id + import_source + external_id. Different agents get separate originals, copy and recreation inventories; existing creator permissions remain.
- Migration 0086 rebuilds only the parent constraint with deferred foreign keys, retaining all source IDs, column values, indexes and child references. Historical materials, publication reservations, revision/timestamps and both request ledgers are preserved. Omitted legacy creates still default to grokbot.
- New source IDs are opaque UUID-based vh identifiers. Returned IDs remain immutable when a provenance label is corrected, allowing the freed agent namespace to be reused without a deterministic-ID collision.
- Same-owner/same-agent duplicate creates and conflicting provenance corrections fail atomically with HTTP 409 and a targeted message. Same-request retries return the original receipt. No automatic merge or overwrite.
- Browser existing-source choices show agent and creator alongside title/external ID. REST metadata/catalog and the shared API guide explain the new rule.
- Deduplication still uses externalId, not parsed video URLs. Browser blank external IDs still get page UUIDs; append versions by explicitly selecting an existing source. Import provenance is caller-declared, never a permission credential. Publishing reservations are unchanged.

## Files changed
- factory-cloud/migrations/0086_psychology_video_hit_source_identity.sql
- factory-cloud/src/psychology-video-hits.js, factory-api-catalog.js and psychology-video-hits.test.js
- public/psychology-video-hit-import.js/.html, psychology-video-hits.html and generated ui-asset-manifest.js
- scripts/psychology-video-hit-import.test.js
- Canonical/generated API guide, CURRENT_STATE and ARCHITECTURE

## Tests performed
- Source/API suite: 27 passed. New cases cover same key/different agents, same-agent duplicates, relabel conflicts and freed namespaces, original/version independence, legacy omitted-field retries, per-user isolation and concurrent duplicate rollback.
- Migration test uses a populated database with foreign keys on, migrates inside a transaction, compares original/source/version/receipt rows byte-for-byte, retains active render/publish references, checks foreign keys and accepts old insert shapes.
- Related administrator, photo/video publishing, cleanup, library, API/MCP, assets and browser regression: 125 passed.
- Final browser import retest after extending source-choice labels: 10 passed, including direct links and two equal original IDs distinguished by agent/creator. Desktop/mobile overflow checks retained.
- No production publication, rendering or image import executed by tests. Only read-only production schema/count checks before deploy; no active jobs interrupted.

## Unfinished work
Production deployment and read-only verification pending at commit time.

## Recommended next step
After rollout, use a stable externalId and explicit importSource for each agent, and select the corresponding source when appending versions.
