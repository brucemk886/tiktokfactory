# Video Hits original retention and continued creation

## Goal
Keep successful original topics, original copy and original images for continued recreation while removing published recreation media.

## Decisions
- Cloud cleanup retains original source copy and version-0 references permanently, including explicitly archived sources. Original references protect shared R2 image files. Previously deleted original bytes cannot be recovered; legacy UI explains that they can be replenished.
- Only confirmed published recreation content is purged after the existing 24-hour grace. Pending, failed, unknown and draft versions, active work, shared references and once-only publication/digest records keep their existing protections.
- Twenty now means at most twenty uncleared versions per source. The unchanged grace consumes capacity until cleanup completes. Migration0085 preserves every prior version/frame column, receipt/render triggers and indexes while widening version numbers; the insertion trigger fences concurrent admission. Draft updates remain possible at capacity. Original frames stay version0; the UI and REST/MCP get.nextVersion suggest the next unused number (21, 22, etc.). Cleaned identities are never recycled.
- Source lists distinguish active capacity from cumulative history. Archive is optional after all versions publish and only hides/freezes the source. Restore returns it to the active list for new creation with a revision-guarded, idempotent REST/UI operation. MCP material consent excludes both archive and restore; schema version is1.6.0.
- No publishing API requests or background-worker restarts are needed. Existing queued/running tasks and old planning are unchanged.

## Files changed
Migration0085; Video Hits source, cleanup, publishing validators, API/MCP catalog; shared contract; source/recreation/detail UI and manifest; focused cloud, migration and browser tests; API guide and architecture/current state.

## Tests performed
Focused cleanup/import/REST/MCP/photo/video suite:123 passed. Covers permanent unique/shared originals, archive/restore revision/idempotency/ownership, twenty active capacity, concurrent insertion, cleanup release, version21 frame writes and photo/video queue reservation, preserved seeded migration rows/triggers/indexes/foreign keys. Full suite passed1400/1400 including real Chrome desktop/mobile, archive restoration, retained original text and full-capacity cleanup/new-version21 flow. After integrating the latest member-permission changes, the combined full suite passed1423/1423. Manifest and diff checks passed; the continuation screenshot was visually inspected. Production read-only precheck found64 sources,125 versions,915 total frames,474 original frames and zero previously cleaned original sources. Tests use local mocks; no real publishing calls.

## Unfinished work
Implementation, full verification and production deployment are complete.

## Recommended next step
Use the existing original source and a new nextVersion for every fresh recreation. Do not overwrite or resend a published identity.

## Release evidence
Runtime commit05a893f076901412bdd9c0b5b1dfd6c05f821d42 was pushed to GitHub main and deployed via npm run deploy from a clean exact HEAD == origin/main checkout. Migration0085 applied successfully (23 commands,49.33ms). Cloudflare version9f37209c-df11-4024-a6ee-11dda4b2023b deployed with all existing cron/queue/workflow bindings. Post-migration read-only counts exactly matched the precheck:64 original sources,125 versions,915 frames,474 original frames,zero previously cleaned originals. The active-capacity trigger exists. Live psychology-video-hits.js and the API guide returned200 and matched release SHA256; private cleanup remained401 without login. Existing transfer PID100756 retained start time2026-10-08 17:13:34.
