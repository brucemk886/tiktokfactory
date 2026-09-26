# Project-wide unified API

## Goal
One project key, separate psychology/photo-factory modules, same read/write/execute permission, with instructions an external AI can use directly.

## Decisions
- One singleton hashed project key bound to its creating active administrator. Current module/account checks continue on every call. Legacy specialized keys remain unchanged.
- One GET catalog / POST action endpoint at `/api/v1/factory`; fixed dispatch table, 128 KiB JSON limit, no arbitrary proxy.
- Writes require UUIDs and use durable receipts. Repeats return saved results; changed payloads conflict. Uncertain outcomes stay claimed, require business-record inspection and are never automatically rerun.
- Same key can create/start automatic operations and create/retry official publish batches. Existing paused/draft-first business creation is preserved.
- UI shows metadata and plaintext once, copies AI instructions separately, and switches module catalogs locally.

## Files
- New migration 0064, factory-api.js/catalog/tests, public factory-api.html/js/css, docs/FACTORY_API.md.
- Wiring: index.js, auth.js, sidebar.js, pages.js, two trusted existing API adapters, package test list and generated UI manifest.

## Verification
- Full factory suite: 831 tests passed, including 17 new gateway tests covering both modules, rotation/revocation, current permissions, ownership, unknown operations, bounds, revision guards, concurrent retries, publication/model deduplication and uncertain result handling.
- Browser local preview with fake credentials: initial load, both module catalogs, masked one-time key display, clear display, rotation confirmation/cancel. Browser screenshots timed out on the host; semantic DOM checks succeeded.
- No live key created/rotated, no real generation/publishing invoked, no running jobs interrupted.

## Unfinished / next step
- No implementation blockers. Production key is intentionally created by the operator in the new UI.
- Future modules add explicit catalog entries and reuse the project key. Retention for mutation receipts can be designed later without making old execution IDs replayable.
