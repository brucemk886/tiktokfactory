# Per-original copy rewrite details

## Goal
Rename 同行原文 to 爆款文案 and organize multiple reviewed rewrites underneath each original.

## Decisions
- Original rows display this operator's total/enabled version counts and open a source-specific rewrite dialog.
- The dialog contains the original, paginated versions, full preview, manual reviewed creation, Grokbot JSON import and enable/disable controls.
- Source-bound GET/POST resolve a completed original server-side. Canonical source matching is exact; mismatched import keys fail before any write. Versions remain owner-scoped and immutable.
- The bulk/all-version dialog retains older imports, including custom source keys without a matching extracted original. No guessed title-based reassignment.
- Copy-library administrators can manage copies without access to style bindings. Publishing still requires its existing permissions. Current variants remain 1–6-page photo copy, including adaptations of video originals; no new video-script publishing lane or AI rewrite call.
- Migration 0045 adds only an owner/source index.

## Files changed
- public/psychology-copy-library.html, .js, .css
- factory-cloud/src/psychology-copy-library.js, psychology-creative.js, psychology-creative.test.js
- factory-cloud/migrations/0045_psychology_copy_variant_source.sql
- Current state, architecture and operator documentation

## Tests performed
- All 566 factory tests passed, including new exact-source pagination/counts, owner/module authorization, mismatched imports and pending-source rejection.
- Headless Chrome with synthetic data passed detail opening, nested full preview, manual version submission, switching source, empty state and all-version access; no page errors. Screenshot visually inspected.
- node --check and git diff --check passed.

## Unfinished work
Production deployment and read-only smoke verification follow this commit.

## Recommended next step
Open 文案库 → 爆款文案 → 改写详情; import reviewed versions or add one manually, then choose reviewed copy in photo auto-publish.
