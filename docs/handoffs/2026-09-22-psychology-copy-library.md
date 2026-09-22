# Psychology copy library

## Goal

Separate visual styles from copy management and automatically archive original copy from every imported psychology peer video/photo.

## Decisions

- Sidebar entries are now `图文样式` and `文案库`.
- Original peer content and reviewed Grokbot photo rewrites are separate tabs. Extraction does not enable, generate or publish content.
- Video records keep the source caption, original-language speech transcript and ordered visible text. Photo records keep the source caption and indexed text for the first six imported images, matching the existing photo-production limit.
- Existing peer hits are backfilled. Accepted imports mirror the source and original-copy row in one D1 batch; reimports update the same record, and completed text is preserved unless the media type changes.
- Dispatch is bounded to three durable workflows. Stable workflow IDs and attempt guards prevent duplicate paid work; row failures do not block the lane. Timed-out paid work waits for manual retry.
- Supplied transcript/page text and the existing photo copy cache are reused. Temporary photos/videos are deleted after extraction.

## Files changed

- Migration 0043, copy-library API/dispatcher/workflow, workflow binding and minute scheduling.
- Photo workflow extraction-only adapter.
- New `/psychology-copy-library` UI, sidebar/permission/page routing, and simplified `/psychology-publish-designs` UI.
- Focused tests and operator/API documentation.

## Tests performed

- Copy-library integration suite covers atomic mirroring, backfill-compatible schema behavior, filtering/pagination/permissions, maximum concurrency, uncertain dispatch recovery, retries and stale attempts.
- Provider paths cover supplied text, cached photos, first-time photo extraction, video success/failure, R2 cleanup and the absence of rendering/publishing side effects.
- Full repository suite passed: 563 tests, including permission, queue, publishing and migration coverage. Production browser smoke is the final deployment verification.

## Unfinished work

- None after production deploy and smoke test.

## Recommended next step

Use the original-copy export for Grokbot rewrites, then import reviewed photo variants into the second tab and compare them in the existing content-effect report.
