# Retain rejected rewrites and allow manual approval

## Goal
Show failed model outputs and quality reasons in library version counts and rewrite details, allowing user review/approval.

## Decisions
- Migration 0055 adds review_status, review_reason, raw_response, reviewed_at. 0054 is reserved by another ongoing task and is not included here.
- Batch generation preserves malformed responses as one pending record and invalid individual versions as separate records. All-rejected batches no longer throw away output. Network/provider errors still fail without fabricating output.
- Accepted/pending records persist atomically, stable hashes deduplicate identical responses, created/pending counts reflect actual inserted rows. Deleted records stay tombstones.
- Pending rows are enabled=0, with DB triggers preventing accidental enable. Generic PATCH only enables approved rows. Cross-source quality checks ignore pending outputs.
- Owner/admin approval bypasses subjective quality checks while enforcing title/caption length and 1–6 valid text pages. UI shows raw output and reason plus editable required fields. Approval records timestamp, retains raw output/reason/model, and enables the version. No existing jobs are changed.
- Single-draft AI generation remains the existing manual draft flow. Historical rejected output was not stored and cannot be recovered from the library.

## Files changed
Migration 0055; psychology-copy-generation, creative, copy-library and rewrite-quality modules; library UI/peer list/batch progress scripts and HTML; focused AI/UI tests and peer fixture; CURRENT_STATE.

## Validation
676 full-suite tests passed, including raw malformed retention, all-rejected response, exact reason, pending disable trigger, generic-enable prevention, owner/admin approval restrictions, structural correction, repeated approval/generation, unchanged raw response and UI escaping. No real model or publishing calls.

## Next step
Ship via main with npm run deploy; verify online library and review dialog without mutating production content. User should wait for any current browser batch to finish before reloading for the new UI.
