# Selected-video schedule feedback and edited retries — 2026-10-09

## Goal
Explain why a selected 14:06 publication can fail the five-minute lead window and ensure edited schedules are used on retry. Preserve already queued work.

## Decisions
- Keep the existing five-minute / fourteen-day admission window, applied to every item including per-account interval offsets. Exactly 14:06 remains valid at 14:01:00 but fails at 14:01:20; no submitted schedule is silently shifted.
- Share pure schedule formatting/validation between selected-video browser preflight and the server. Show the offending item's submitted time, current time and earliest selectable minute, or final-date overflow. Backend errors explicitly use Asia/Taipei; browser labels and 24-hour hints use its resolved device timezone.
- Add a user-clicked current-time +10-minute shortcut. Refresh visible time hints every 30 seconds. Validation errors stay inline rather than covering mobile inputs with stacked notifications; HTTP 4xx errors omit the misleading generic retry suffix.
- Preserve frozen request IDs/mappings for unchanged ambiguous retries and existing-batch replay after the time window expires. Changing date/time or interval resets the payload; submission also compares raw field values so a missing input event cannot resend a rejected old time.
- Existing queued tasks, reservations, permissions, cleanup and transfer workers are untouched. User supplied a screenshot showing twenty videos queued successfully during this work; it is not evidence of final TikTok publication.

## Files changed
public/psychology-publish-time.js; psychology-auto-publish.js/html; factory-cloud/src/psychology-video-library.js; UI manifest; test registration and focused timing/publishing/browser tests; current state and this handoff.

## Tests performed
57 focused tests passed: exact five-minute second boundary, every-item fourteen-day limit, invalid timestamps, existing-batch replay, device datetime conversion, assignments, UI, library and assets. Real Chromium local mock covers early-time blocking before POST, +10-minute action, server time rejection, corrected retry even without an input event, unchanged network retry, desktop/mobile and existing normal/photo/One flows. No real publishing API calls. Final browser run passed; mobile schedule screenshot visually checked at primary tmp/one-time-ui/schedule-mobile.png. Manifest and diff checks passed.

## Release evidence
Runtime commit 12727b89cc0f46cb95fbe31b055f20c689f42dd3 was pushed to GitHub main and deployed via npm run deploy from a clean exact HEAD == origin/main checkout. Initial trigger update hit a transient cron fetch failure; repeating the same guarded deploy succeeded and listed all four cron schedules plus queue/workflow bindings. Final Cloudflare version fc3fde04-da03-4391-9ca4-eaa62e5a3d49. Live publisher and time-helper JS hashes matched; private video inventory remained 401 without login. Existing transfer PID 100756 retained its 2026-10-08 17:13:34 start time.

## Unfinished work
Implementation, testing and deployment complete.

## Recommended next step
Refresh the creation page for the improved hints. Existing queued batches continue independently; no resubmission is needed for a successfully queued batch.
