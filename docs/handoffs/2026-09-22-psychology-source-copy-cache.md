# Goal
Reuse text-focused peer photo posts across recreations without repeatedly resolving TikHub or retaining source images.

# Decisions
- Shared D1 copy cache stores source title/caption and validated ordered per-image text, template classification and background descriptions, scoped by operator and canonical post ID (share-link path fallback).
- Extract originals first, regardless of rewrite setting; optional rewriting is a separate text-only call. Render templates/backgrounds do not mutate the cache.
- 10-minute renewable extraction lease, bounded durable 15-second waits, owner-checked writes/releases and corrupt-entry repair. Successful extraction survives downstream rewrite/stock failures.
- Source images remain temporary; cleanup runs immediately after extraction plus the existing final cleanup. No new R2 retention. Cache records max 128 KiB.
- No historical backfill: old plans may already contain rewritten copy. The next uncached draw populates the entry. No publishing tasks created or retried by this change.

# Files changed
factory-cloud/migrations/0037_psychology_photo_copy_cache.sql; factory-cloud/src/peer-photo-copy-cache.js; factory-cloud/src/peer-photo-workflow.js; factory-cloud/src/psychology-peer-production.test.js; docs/CURRENT_STATE.md; docs/ARCHITECTURE.md.

# Tests
Factory full regression suite (515 tests); focused coverage for miss/hit avoiding TikHub/CDN/vision, canonical URL reuse, text-only rewrites, immutable originals across template changes, concurrent single extraction, invalid-result recovery, downstream failure retention, owner scope, stale leases and corrupt cache repair. All providers mocked; no publishing API calls.

# Remaining / next step
Deploy committed and pushed main with npm run deploy from factory-cloud; verify migration and deployed health. Deployment result is reported in the task response.
