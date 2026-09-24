# 2026-09-24 Translation fallback investigation

## Goal
Explain why an imported Grokbot translation falls back to DeepSeek and why the comparison showed a generic failure.

## Findings
- The affected version has imported original/rewrite translations and valid body references. Exact current-unit comparison found one missing original caption translation; no missing rewrite text or invalid original body reference.
- Current code accepts imported comparison only when every unit validates; one missing original caption discards the imported comparison for display and invokes full DeepSeek translation on explicit view. Partial-import rendering/filling is not changed by this diagnostic task.
- Previous failures were caught and returned as a generic 502 with no cause persisted, so the historical provider/validation failure cannot be reconstructed reliably.
- A live retry of the same version after diagnostics deployment succeeded. D1 read-only verification confirmed eight original and eight rewrite units in the cached result and released lease. No reimport, version modification or publishing was performed.

## Change
psychology-copy-comparison.js now distinguishes provider HTTP/network/timeout failures, response validation failures and cache write failures. Logs contain stage/status/variant identifier only, not provider message, key or source copy. Existing validation messages are returned safely. Regression test checks validation detail, redacted provider 429 and timeout, and lease release.

## Validation / Deployment
- 659 factory tests passed before cherry-picking onto the latest unrelated Replicate token-limit fix.
- Commit 1e7cf93 pushed to main; standard factory-cloud npm run deploy passed its clean synchronized-main guard.
- Production version ea750c3c-66a4-40a8-ba40-79b1ed186af2.
- Browser confirmed successful comparison and Chinese translations; session closed.

## Remaining
Historical failure subtype unknown because the old code discarded it. Future failures display the concrete stage/cause. Consider retaining partial imported translations and supplementing only missing units to avoid the unnecessary full fallback.
