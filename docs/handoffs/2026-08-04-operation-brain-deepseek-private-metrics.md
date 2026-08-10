# Operations Brain DeepSeek And Private Metrics Handoff

## Goal

Use DeepSeek V4 Flash to process the complete recent owner-authorized video dataset, then let SOL make the final strategy decision from DeepSeek's structured evidence.

## Decisions

- Runtime credentials remain under the configured work directory and are not committed to Git.
- The hybrid route always calls DeepSeek first and then SOL when both services are available.
- DeepSeek receives every recent video and every available second-by-second retention and like-timing point. It analyzes bounded sequential batches, then performs one synthesis pass.
- SOL receives the complete DeepSeek evidence report and preliminary strategy; there is no eight-video representative sample or conditional escalation threshold.
- If DeepSeek fails, SOL is the fallback. If SOL review fails after a successful DeepSeek result, the DeepSeek strategy is retained.
- Private analytics include full retention/like curves, completion, average and total watch time, reach, engagement counts, traffic sources, and audience gender/country/city/type. Captions are included for context; raw comment bodies are excluded.
- Official bridge read failures do not block plan creation or publishing safeguards.

## Files Changed

- `scripts/deepseek-brain.js`
- `scripts/deepseek-brain.test.js`
- `scripts/official-tiktok-analytics.js`
- `scripts/private-tiktok-signals.js`
- `scripts/operation-brain.js`
- `scripts/operation-brain.test.js`
- `scripts/codex-brain.js`
- `scripts/server.js`
- `public/operator.html`
- `public/operator.js`
- `docs/CURRENT_STATE.md`

## Tests Performed

- Focused Node tests for DeepSeek configuration, lossless full-data chunking, private metrics, hybrid routing, and SOL-review fallback: 20 passed.
- JavaScript syntax checks passed for all affected server and browser files.
- Local Factory restarted successfully and `/login` returned HTTP 200 on port 3010.

## Unfinished Work

- Live private-metric routing remains empty until an actively posting account is authorized and synchronized through the official hosted bridge.

## Recommended Next Step

Authorize and sync an actively posting TikTok account, then inspect the next saved Operations Brain plan to validate its private sample count, route reasons, and final provider against TikTok Studio.
