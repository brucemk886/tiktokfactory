# Opt-in psychology photo music pool

## Goal
Add four newly approved songs to the four previously retained tracks; leave music unselected by default and randomly assign only explicitly chosen music when publishing photos.

## Decisions
- User clarified that all future Factory UI work is PC-only. Recorded in AGENTS.md/CURRENT_STATE; removed this change's mobile-specific CSS and additional mobile screenshot requirements. Existing unrelated mobile code/tests are not removed.
- Confirmed the real audition review (2026-10-09T15:34:12.030Z), excluding pending/rejected tracks and QA feedback. Total: eight. Saved all eight through the authenticated Hub music-library endpoint and read back the exact ID set.
- Manual photo creation has an unchecked pool toggle. One click selects the eight-song pool; expanded controls provide previews and subsets. Every new page starts empty, independently of prior batches.
- Imported-photo automatic operations exposes the same picker. It starts empty for existing configurations without musicIds; only an explicit settings save changes future tasks. Receiver/CTA edits, legacy planning and queued tasks are preserved.
- Random draws are independent, so repetition is allowed. The chosen ID is frozen at job creation and preserved by duplicate submissions and retries. Unselected uses existing TikTok recommendations.
- Audition metadata is a reviewed built-in preset library, separate from per-batch selection; later Hub favorites do not silently modify it. All IDs remain strings. No schema changes.

## Approved tracks
- 6873559269682186241 — It's a piano song I made when it was raining(864585) — Lakeside sound studio
- 7592390338558511121 — iloveitiloveitiloveit — Bella Kay
- 7190464410404521985 — Slow and gentle acoustic piano(1388951) — Noru
- 6873874427382073346 — Forgiveness — Renee Michele
- 6954431177495152641 — It's a sad piano song that gently wraps around(992196) — syummacha
- 7619819911367559184 — 雨和我说话的那一天 (The Day The Rain Spoke To Me) (编辑版) — Danbi (단비)
- 6817312345782503425 — Serious and sad song — Aki
- 7076030445804062722 — Twilight, cherry blossoms, dusk, jingle, piano(1211411) — Home-like Music

## Files changed
- AGENTS.md records the Factory-only desktop preference. Shared public psychology-photo-music library/picker/styles, both manual publishing and imported-photo operations pages.
- Shared draw/validation policy; auto-publish, video-hit photo creation and imported-photo settings/scheduler.
- Focused backend, browser and VM tests; asset manifest; CURRENT_STATE and ARCHITECTURE.

## Tests performed
- 121 focused backend/policy/VM tests passed: default empty, chosen-only draws, independent repeated draws, immutable replay, explicit clear and section preservation.
- Imported-photo browser regression and selected video/photo full flow passed. Desktop 1440px and mobile 390/320px have no horizontal overflow; inspected captured music-picker screenshots. Test publishing endpoints were local mocks only.
- Full declared run: 1,495 tests, 1,494 passed and one stylesheet-order assertion failed. Fixed the autopilot stylesheet insertion order; all 60 affected theme, publishing and operations tests then passed. No remaining test failure. Production verification follows below.

## Unfinished work
None. No real posts were created and no automatic settings were enabled or changed.

## Recommended next step
After release, refresh the photo creation or imported-photo operations page. Tick the music pool when wanted; save automatic settings explicitly for future scheduled tasks.

## Release verification
- Runtime commit 2390e3e1abd5d887e99a2d69a6d9979802151331 was pushed to GitHub main before deployment. Clean worktree and exact HEAD == origin/main checks passed.
- The first standard deploy stopped on Cloudflare D1 7403. A normal retry succeeded without changing credentials or bypassing checks; no migrations were pending. Worker version: 2f38dc00-1814-4c13-b25d-9042b53d4334.
- Production picker, library, CSS and both integrated scripts returned HTTP 200 with exact normalized SHA-256 matches to the committed files. Anonymous options API returned 401.
- Logged-in production desktop verification: eight tracks, initial checkbox unchecked; clicking selects all eight, clicking again clears all. All preview audio stays paused with preload=none, and the PC viewport has no horizontal overflow. No publishing or settings-save buttons were clicked. The agent browser session was stopped.
