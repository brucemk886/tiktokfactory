# Remove scheduled-comment caption suffix

Date: 2026-09-23

## Goal
Remove the redundant publishing-caption teaser from psychology scheduled-comment settings; generation already provides the user-facing guidance.

## Decisions and files
- public/psychology-comments.html and .js: remove the field, help and request/local-state binding.
- factory-cloud/src/psychology-comments.js: legacy caption settings are inert; old clients may still submit them but saves clear the value. New scheduled comments keep an empty legacy column.
- factory-cloud/src/psychology-auto-publish.js: never append or truncate videoDesc for a scheduled comment.
- Per-topic reveal text, delay, auto replies, and existing immutable jobs remain unchanged. No migration or active-job changes.

## Validation
- 19 focused scheduled-comment tests passed, including legacy settings and per-topic reveal snapshots.
- All 604 factory tests passed.
- Mocked Chrome UI: no caption input, saving settings omits caption, delay and automatic replies preserved; no page errors or live API writes.

## Remaining
No implementation work remaining. Existing created jobs retain their original publishing snapshots.
