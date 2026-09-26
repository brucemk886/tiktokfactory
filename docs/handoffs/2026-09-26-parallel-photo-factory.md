# Parallel photo factory — 2026-09-26

## Goal
Add a photo-only, direction-configurable content factory next to the existing psychology system. Keep its active seven-day experiment intact; the user will later test Zodiac or new Psychology groups and decide about migration.

## Decisions
- Separate direction/copy/pilot/slot/job/reservation/key tables (migration 0062); no legacy records copied, reclassified or updated.
- Shared card renderers retain the old 3:4 default. New jobs explicitly opt into configured aspect, default 9:16. Existing video paths remain independent.
- Admin-only new module. Existing psychology-publish admins receive the additional new module navigation; operators are not granted access.
- New pilots are drafts. Start is explicit. Existing psychology group/account occupancy is checked at create/start, planning and execution. Database guards protect new active pilot conflicts and job scope.
- Separate Workflow dispatcher, max 2 new rendering workflows, <=100 planned items/tick, group <=100. Stable slot/source reservations, frozen request and externalId protect duplicate publication. Pauses stop unsubmitted jobs while preserving ambiguous submissions for receipt reconciliation.
- Copy content, metrics and rules are direction/owner-scoped. Grokbot import keys bind one direction and cannot control publishing. Original/rewrite effect stats use actual local post observations.
- Detailed user/API documentation: docs/photo-factory.md.

## Files
- factory-cloud/migrations/0062_photo_factory.sql
- factory-cloud/src/photo-factory-domain.js, photo-factory.js, photo-factory-execution.js, photo-factory.test.js
- public/photo-factory.html, photo-factory.css, photo-factory.js
- Hosted router/pages/sidebar/auth, entry workflow export, wrangler binding and test list
- public/psychology-card-runtime.js: optional aspectRatio only, backwards-compatible default
- psychology-autopilot.test.js: existing today-view assertion now excludes tomorrow's reserved slots; production legacy logic unchanged

## Validation
- Factory full suite: 784 tests passed (19 focused new tests). Includes permissions, cross-direction imports, import-key revocation, copy immutability, draft start, legacy overlap protection, atomic allocation, unjudged sample caps, pause, exact metric identity/zero, cross-day effects, concurrency limit, immutable retry request and legacy upload pass-through.
- Isolated localhost UI with in-memory SQLite and mocked account directory; no real AI or publishing network. Created Zodiac direction, selected preset, previewed 3 cards (1080x1920), visually checked rendered cover, added a copy and verified empty-sample stats. Created two group drafts with 10-minute group offsets and 30-minute per-account intervals; neither was started.
- Desktop 1440 and mobile 390 DOM bounds showed no horizontal overflow. Browser screenshot transport timed out; actual locally generated card was separately inspected. No screenshot-based whole-page visual QA claim.

## Release / unfinished
Commit, push main, guarded deploy and live read-only verification follow this handoff. No production direction/copy/pilot is created by deployment. No migration or old-task cutover is authorized yet.

## Next step
User creates a Zodiac direction, imports copy, uses idle test groups, reviews previews and explicitly starts drafts. Later decide whether/how to migrate the existing psychology experiment. Independent excerpts are supported; continuous fiction chapters and a full-scale throughput certification remain separate work.
