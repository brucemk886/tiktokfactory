# Rewrite original comparison, Chinese translations and scoring — 2026-09-24

## Goal and authorization
Show original text for rewrite titles/every sentence, with Chinese translations on both sides. User explicitly authorized sending viewed original/rewrite text to the existing DeepSeek API after automatic review asked for destination-specific authorization. Future Grokbot imports should include translations and quality scores; high scores sort first.

## Decisions
- GET /api/psychology-creative/copies/:id/comparison returns cached or supplied comparison, otherwise pending text. POST generates missing translations/matches using existing DeepSeek client; no generation on list load.
- Check existing admin/module rights, variant owner, deletion and exact original source key. Titles/captions pair by field. Body semantic matching uses validated original unit IDs; display original text only from saved library, never model-generated quotations. Unmatched content is explicit.
- Migration 0049 adds one cache row per variant with source/rewrite hash + 150-second lease. Validated results only; provider failures release lease; concurrent requests do not duplicate inference. GET polling never generates.
- Grokbot rewrites accept score 0–100, scoreReason and comparison.original/rewrite arrays using exact source strings + Chinese. Valid supplied comparisons bypass model; incomplete legacy data may fall back. Same-content IDs allow metadata enrichment, no content replacement or tombstone resurrection. Existing omitted metadata survives resends.
- Lists globally sort score DESC then created_at DESC/id; zero above NULL. Score is quality review, not a traffic prediction, and does not change auto-publish selection.
- Added bilingual two-column responsive dialog, source sentence labels, explicit loading/error/retry, stale-dialog response guard. List adds score/hover reason. Updated page writing example and API docs for Grokbot (no direct Grokbot control available).

## Files
- factory-cloud/migrations/0049_psychology_copy_comparisons.sql
- factory-cloud/src/psychology-copy-comparison.js, psychology-copy-review.js, psychology-creative.js, psychology-peer-hits-store.js
- public/psychology-copy-library.html/js/css, psychology-peer-hits.js
- tests: psychology-copy-comparison.test.js, psychology-peer-hits.test.js, scripts/psychology-copy-library-ui.test.js, package test script
- docs/CURRENT_STATE.md, docs/psychology-peer-hits-api.md

## Validation
- 628/628 tests pass, including source identity, owner/role/CSRF/deletion, model validation, cache invalidation, concurrent lease, retry, Grokbot no-model path, metadata enrichment, sorting, and escaped markup.
- Local browser with synthetic data: opened rewrite list (score 94), comparison displays title and two body rows, both Chinese translations and unmatched original. Computed comparisonDialog is open modal, display block, 1200px wide; no app exceptions (extension abort diagnostics only).
- Screenshot tool returned stale/incomplete captures, so used DOM and computed geometry evidence instead; not claiming screenshot validation.
- No real publishing calls in testing. Deployment/live one-version translation smoke test follows required main gate.

## Follow-up
For new content, give Grokbot the API schema/instructions or the updated writing-interface example. Historical versions translate lazily on view; no bulk translation or invented historical scores.

## Follow-up: remove comparison clutter
- Remove the repeated original page/sentence label inside each card.
- Strip hashtags from comparison text/translations and omit tag-only rows, including tag-only sixth pages. Suppress caption rows identical to titles after tag removal.
- Deduplicate original references by kind/text, preferring the rewrite card with the same page/sentence label. Shared references displayed elsewhere are labeled accurately instead of falsely called unmatched.
- Remove the trailing unused-originals section. Stored content, translation cache and publishing data stay intact; cached historical views use the new display immediately.
- Validation: 7/7 UI regression tests, including the user's page-3/page-4 duplicate and tag-only sixth-page case; git diff --check.

## Follow-up: visible original IDs
- Lists show the full library ID under title/account in both media tabs. The ID text can be selected without adding a copy action button.
- Original preview metadata shows library ID plus sourceKey; Copy full text includes these identifiers without duplicating them inside the visible body. sourceKey remains the association key for standalone variant imports; peer-hit imports still use original post URL.
- Files: public/psychology-peer-hits.js, psychology-copy-library.js/html/css. Validation: JS syntax, existing UI tests 7/7, git diff --check. No API/data changes.
