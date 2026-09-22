# Unified psychology source and copy library

## Goal
One content page instead of separate peer-hit and copy-library pages, retaining video/photo classification and all existing import/rewrite functions.

## Decisions
- Canonical /psychology-copy-library displays video/photo tabs, source performance and accounts, extracted copy, status and per-original rewrite details in one row. Completed copy remains the default. Optional scopes expose all imports, queued/running/failed and historical auto_extract=0 rows without triggering backfill.
- GET joins sources by exact ID and owner-scoped variants by canonical source key. Pagination remains 20. Source deletion continues to retain stored original copy, variants and already-created jobs; the UI explicitly labels it 删除来源.
- Source manual import, key management, voice selection, media corrections and original-media recreation reuse the original APIs and permissions. 文案库-only admins cannot manage peer sources. Legacy peer-only admins can read and manage rewrites in the unified page; operators stay denied.
- Top-right bulk import remains a dialog. Copy-based generation is linked through 自动发布; 原帖复刻 explicitly uses source media.
- Legacy peer URLs redirect after authentication, preserving query strings. The old static HTML is a redirect fallback. The legacy permission catalog entry remains hidden under 文案库 to avoid invalidating saved grants; only the single canonical entry is visible.
- No schema migration, data rewrite, API-key rotation, provider call or queue change.

## Files
Cloud copy-library list and creative authorization, sidebar/index routing; copy-library HTML/JS/CSS and shared peer/production UI; related-page links; copy-library and source/module tests; state/architecture/operator docs.

## Validation
Backend tests cover exact source metrics, status/media/query/sort, pagination, retained copy after source deletion, source-management and operator boundaries, source-bound variants and authenticated legacy redirects. Headless Chrome with synthetic APIs verifies single sidebar, media/status pagination, full text, source-bound import, bulk import, desktop/mobile, copy-only control gating, and no script errors. Screenshot inspected. No real posts or imports created.

## Remaining
Commit/push main and standard deployment, then read-only live page verification. No unfinished implementation. Content tags and historical extraction remain deferred as requested.
