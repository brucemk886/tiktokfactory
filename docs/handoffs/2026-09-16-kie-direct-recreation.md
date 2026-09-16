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
- Full suite after direct-provider and cleanup regressions: 319 passed.
- Direct-Kie commit `872f7c9` deployed successfully. Live request identified the actual error: `Failed to download fileData.fileUri: HTTP 206`.
- Signed source endpoint treated R2 full-object range metadata as a partial response even without a client Range header. Fix requires the request Range header before returning 206; full downloads return 200. Tests cover both cases.

## Remaining work
Deploy the full-download status fix and verify a fresh direct-Kie attempt. Do not claim generated assets until verified.
