# Direct Kie analysis for psychology recreation

## Goal
Switch the recreation pipeline directly to paid Kie Gemini 3.8 Flash as requested, removing Google upload/retry delays.

## Decisions
- The recreation workflow explicitly chooses Kie; it no longer needs GEMINI_API_KEY.
- Independent AI workbench video analysis keeps its existing provider policy. Shared analysis workflow supports explicit direct-Kie selection.
- Kie reads the private temporary R2 file through its existing signed URL. One paid analysis submission, no automatic duplicate paid retries.
- Capture real Kie errors even in HTTP 200 envelopes; distinguish non-JSON and empty responses. Error details redact keys and URLs. Diagnostic logs omit request bodies, video URLs and answer contents.
- Keep original-video cleanup and review-board generation behavior.

## Files changed
- factory-cloud/src/gemini-video-workflow.js
- factory-cloud/src/kie-gemini-video-client.js and tests
- factory-cloud/src/psychology-recreation-workflow.js and tests
- factory-cloud/src/psychology-peer-production.js and tests
- docs/CURRENT_STATE.md

## Verification
- Automated coverage: direct Kie recreation with no Google key, direct failure cleanup/no image billing, submission without Google, provider errors and JSON envelopes.
- Final full suite: 320 tests passed, no failures or skips.
- Direct-Kie commit `872f7c9` deployed successfully. Live request identified the actual error: `Failed to download fileData.fileUri: HTTP 206`.
- Signed source endpoint treated R2 full-object range metadata as a partial response even without a client Range header. Fix requires the request Range header before returning 206; full downloads return 200. Tests cover both cases.

## Production result
- Commits `872f7c9`, `ff86efe`, and `a13e258` were pushed to GitHub main and deployed with `npm run deploy` from the clean `work/tikhub-release/factory-cloud` checkout.
- Final code deployment: `5da180e1-7659-4839-aa29-10fdbc18d883`.
- Workflow instance `peer-kie-direct-256bd1d1b9924515-v3` completed successfully, 2026-09-16 18:20:07 to 18:23:38 China time (3m31s total).
- Kie analysis ran 18:20:12 to 18:22:42 (2m30s), returned 4 valid scenes, 3,217 input tokens, 560 output tokens, and 0.27 provider credits. This is analysis cost only, excluding Z-Image and ElevenLabs.
- All 4 images and 4 audio files were generated and archived. Image byte sizes: 750420, 901711, 1178418, 881851. Audio byte sizes: 138388, 114564, 133373, 97010.
- Narration durations: 8.591, 7.105, 8.266, 5.991 seconds.
- `sourceDeleted: true`, no temporary analysis row remains, and no Google upload/analysis steps executed.
- Result: `/psychology-production?job=peer-tikhub-check-256bd1d1b9924515`.
- Only the existing explicitly labeled verification job was retried. No active user job or publishing request was changed.

## Remaining work
None for the requested direct-Kie switch. The recreation workflow ends at the review board as designed; it does not automatically compose or publish a video. The independent AI-workbench video-analysis provider policy remains unchanged. Subsequent real jobs can use `/psychology-peer-hits` normally.
