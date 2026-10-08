# Psychology ready-video input — 2026-10-09

## Goal
Support per-version frame composition or direct finished-video import, explicit full publication and one publication per version.

## Decisions
Private R2 upload uses streamed length/container/SHA256 validation, max95MiB, immutable UUID and shared project key. Ready versions need no frame/script; imported MP4/MOV/WebM use the existing transfer/official-group pipeline. Matching completed renders reuse their MP4. One version and one imported owner/file digest reserve one publication identity; retries retain that identity. Persist genuine published evidence and render state; backfill existing reservations. Public/private ownership and current grants stay mandatory. Existing jobs/planning/processes are preserved. File cleanup remains a future reference-aware design (24h after confirmed publication); no deletion or persistent renderer activation.

## Files changed
0081 migration; psychology-video-hit-videos, video-hit-production, video-hits, video-library, auto-publish grant hook and index; shared version contract; frontend detail/form/viewer, API catalog and guide; tests; CURRENT_STATE/ARCHITECTURE.

## Tests performed
Focused upload/API/state/publishing tests and real Chromium file upload, playback, refresh, explicit publication, desktop1440/mobile390/320 layout checks. Final npm test passed 1317/1317; related final publishing/API/worker tests passed 57/57. UI manifest and git diff checks passed. Desktop/mobile screenshots were visually inspected and the uploaded MP4 was played in Chromium. Deployment result will be recorded below. All publishing services mocked; no live publication tests.

## Unfinished work
Automatic cleanup is not activated; suggested lifecycle is documented in docs/psychology-video-hits-api.md. Dedicated local remix helper remains unstarted pending explicit activation (previous automatic approval review).

## Recommended next step
Use API instructions in the video-hit module for Dot. Ready videos can use the existing transfer worker. Before activating frame processing, obtain explicit background-process activation; do not resume paused historical planning.
