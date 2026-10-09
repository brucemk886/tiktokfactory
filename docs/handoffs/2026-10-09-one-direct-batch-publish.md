# Direct TikTok One batch publishing — 2026-10-09

## Goal
Remove the redundant per-video review step. Select videos, select accounts, select a project, set start time/interval and click publish. Randomly split 20 videos over 10 accounts into two videos each.

## Decisions
- Remove the per-video caption/account editor and native second confirmation from the selected-video One flow. Saved captions travel with each video. An optional collapsed title/removal list stays inside video selection; there are no duplicate video players. AI disclosure is one batch setting.
- Shuffle videos and account order once on submission and distribute evenly. Each selected account receives floor/ceil(video count / account count), differing by at most one. Reject more accounts than videos rather than silently leaving selected accounts unused. Each account starts at the chosen time and advances by its own configured interval.
- Freeze the randomized payload/request ID on first submit and retain it for unchanged retries. Fix retry controls to restore their previous disabled state, so hidden template fields do not block a second click. Move creation-page error toasts above the form so they cannot cover the mobile publish/retry button. Backend account/project, revision, reservation, digest and once-only checks remain in force.
- Keep compact 20-record pagination, cross-page selection, original cleanup policies and active workers. Normal generation/photo publishing is unchanged.

## Files changed
public/psychology-video-picker.js, psychology-auto-publish.js/html, psychology-publish-create.css; UI manifest; factory test registration; assignment/UI/browser regression tests; current-state documentation.

## Tests performed
53 focused assignment, publishing UI, library and asset tests passed. Assignment tests cover all 1–20 video/account combinations, exact 20/10 distribution, per-account intervals, caption preservation and invalid inputs. Real Chromium desktop/mobile fixture passed: no review form or second publish dialog, saved captions/AI flag, randomized balanced payload, simulated failed submission and identical successful retry, cross-page 20 selection, existing One joins/normal/photo flows, lazy cover behavior. All publication calls used a localhost mock. Desktop/mobile captures are in primary tmp/one-direct-ui and were visually checked. Manifest and diff checks passed.

## Release evidence
Runtime commit 2ea1fb3a9e4139e7be35aafe39c50315d26682f6 was committed and pushed to GitHub main, then deployed with npm run deploy from a clean release checkout at exact HEAD == origin/main. Cloudflare version 2853d225-833d-4f80-909e-7f778ac3b6b2. Live publisher JS, picker JS and creation CSS returned 200 with matching SHA-256 hashes. Private inventory requires login (401); creation redirects to login (302). Transfer worker PID 100756 retains its original 2026-10-08 17:13:34 start time.

## Unfinished work
Implementation, validation and deployment complete.

## Recommended next step
Refresh the One creation page and use video → account → project → time → publish.
