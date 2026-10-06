# Psychology content evidence links

## Goal
Make the evidence action in all five psychology content pools list concrete published-work URLs that open directly.

## Decisions
- Exact source, version, text hash, style and style revision select the work evidence. Current canonical psychology account grants and the existing thirty-day reporting window remain authoritative.
- Evidence is independently paginated in ten-work pages. Published works, pending publication reservations, waiting-for-maturity and missing-metric states remain distinct. Zero playback/completion is preserved.
- Prefer the synchronized TikTok share URL; otherwise construct a photo permalink only from an actual synchronized account handle and numeric post ID. Missing links remain explicitly unavailable. HTTPS TikTok URLs only, escaped and opened in a new tab with noopener/noreferrer.
- This feature reads existing facts and analytics; it creates no jobs and sends no publication requests.

## Files changed
- factory-cloud/src/psychology-autopilot-dashboard.js and focused backend tests.
- public/psychology-autopilot-dashboard.js, psychology-autopilot.css, client tests and asset manifest.
- This handoff and CURRENT_STATE.

## Tests performed
35 focused dashboard tests passed, including all five pools, exact identity, pagination, account permissions, missing/zero metrics, invalid URLs and read-only behavior. Full factory regression: 1,247 passed, zero failures/skips. Asset manifest and git diff checks passed.

## Release
Runtime commit d98ffd54ea5d43cf2bc0bce6cb36c017bb83670e was pushed to GitHub main. The existing clean main release checkout was fast-forwarded to exact origin/main before npm run deploy. Worker version 78425a6c-77c2-4e8a-b5e6-f190d228fd90 deployed to factory.tiktokaitool.com. The original user checkout and its unknown files were preserved.

## Unfinished work
None for the implementation. Works without a synchronized share URL, handle or post ID display a missing-link message until the existing sync supplies them.

## Recommended next step
Use automatic operations → content execution details → any pool → evidence to inspect corresponding works.

## Production verification
Authenticated factory UI displayed 19 winner, 22 optimization, 27 potential, 2,188 pending-validation and 64 revision versions. A real winner evidence dialog listed five concrete TikTok photo links with publication account/time, playback and completion. The independent pagination showed 17 total work/reservation records across two pages; page two retained the same selected content version and seven remaining records. The dialog had no horizontal overflow at 390 or 320 pixels. No publishing or configuration action was performed during verification.

A real optimization version also exposed five clickable published-work links and seven total records. Long TikTok URLs remained within the 320-pixel dialog.
