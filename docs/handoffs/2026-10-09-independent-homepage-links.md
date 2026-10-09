# Independent homepage short links

## Goal
Allow every scoped thousand-follower account to generate/copy its own homepage link without becoming an automatic-publication receiving account.

## Decisions
- Separate link inventory from analytics and receiver settings with GET /api/psychology-website/links. POST on the same endpoint remains bulk-compatible and accepts optional connectionIds for a single/selected set.
- Eligibility uses current permitted psychology account groups, synchronized >=1,000 followers and valid identity. It does not require receiver selection or video.publish scope. Existing fresh website-module and project-owner guards remain; cross-site writes and outside/under-threshold selections fail.
- Stable existing codes remain unchanged on retries/concurrent calls. Reads do not create links. Creation returns all eligible account links for immediate copying; no site analytics binding is required.
- The configuration page lists all eligible accounts with search, per-row generation/copy, bulk generation and tab/newline-separated account+link copy. Clipboard denial exposes selectable text and copying can be retried. Generating/copying links does not change CTA drafts, receiver choices, link-ready confirmations, enable states or jobs.
- Receiving settings continue to choose only the accounts mentioned in automatic captions; homepage profile edits remain a user paste action. Overview uses homepage-account labels for the wider link population.

## Files changed
- factory-cloud/src/psychology-website-links.js and psychology-website.js plus focused tests.
- public/psychology-website-links.js (new independent client), website HTML/CSS/main JS, receiver copy; browser tests; generated manifest and API guide.
- CURRENT_STATE, ARCHITECTURE, canonical API guide and this handoff.

## Tests performed
- Fixtures: independent link eligibility, no video.publish scope, exact thousand threshold, no receiver config, individual/bulk creation, stable retries, scope removal, permission/CSRF/invalid input rejection, analytics outage independence, no receiver/campaign mutation or provider publishing.
- Chromium: actual row/bulk request bodies, exact clipboard content, copy without regeneration, search, clipboard failure/recovery, unchanged receiver selection/CTA drafts, desktop/mobile and old tab links.
- Final declared suite and release checks pending.

## Unfinished work
Deployment verification pending. No real profile edits or publication invoked.

## Recommended next step
Open 引流配置 → 千粉账号主页短链接, generate all, then copy each account's link into its profile. Select receiving targets separately only when desired.
