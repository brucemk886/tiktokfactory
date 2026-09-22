# Template-linked automatic replies

## Goal
Replace manual account/video enrollment with automatic enrollment from batch publishing and scheduled reveal comments.

## Decisions
- Template settings own an opt-in automatic reply policy (48 hours, 100 replies/video defaults). Requires scheduled reveals.
- Each future video batch freezes its selected question ID and A/B/C/D answers with the reveal task. Missing answers or account comment-read permissions fail validation before task creation.
- Confirmed publication receipts supply account/video identity. Reveal scheduling and reply enrollment commit atomically; unique account/video keys prevent duplicate enrollment.
- Reply start is the planned reveal time, not confirmation that the reveal comment succeeded. Existing reply queue pacing/permissions/recovery remain in effect.
- Historical tasks without snapshots are not enrolled. Existing manually created watches remain manageable.
- Template settings precede reply tasks; manual account/video form removed. Per-question answers remain editable in the topic bank.

## Files changed
Migration 0041; psychology-comments backend/tests/UI; psychology-auto-publish permission validation; topicSource mapping; auto-reply list UI.

## Tests
542 factory tests passed, including batch snapshots, failed publication, duplicate receipt enrollment, frozen per-question answers, legacy exclusion and policy validation. Frontend syntax and git diff checks passed. No real comments sent.

## Unfinished work / next step
Deploy committed main and verify hosted template controls/list order. Operators must fill each question's reply options and enable the template policy for future batches.
