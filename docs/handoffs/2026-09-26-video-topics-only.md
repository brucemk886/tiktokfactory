# New psychology video tasks use template topics only

## Goal
Keep only 模板题库 as the source in the new psychology video publishing form.

## Decisions
Video creation defaults to topic-bank and shows the concrete bank selector immediately. No copy-library/rewrites/peer options or permission fallback are offered. Missing topic permission reports an explicit error before submission. Photo creation and existing batch configurations/API source compatibility are unchanged. Optional TikTok One publication remains available.

## Files
- public/psychology-auto-publish.html
- public/psychology-auto-publish.js
- scripts/psychology-auto-publish-ui.test.js

## Validation
23 UI tests passed, including default topic visibility, stale source protection, permissions and video/photo switching. 61 publishing/TikTok One tests passed without live external writes.

## Remaining
No implementation work remaining. Release uses clean main aligned with origin and the standard factory-cloud npm deploy script; production check is read-only.
