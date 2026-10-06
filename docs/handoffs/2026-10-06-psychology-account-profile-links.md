# Psychology account profile links

## Goal
Click an account name in the automatic-operations traffic list to open its TikTok homepage.

## Decisions
Account names use native HTTPS TikTok profile anchors in a new tab with noopener/noreferrer. All traffic tiers share this behavior; the right-hand detail action still opens local analytics. URLs derive only from the current synchronized canonical account username, never a display label or connection ID. Missing/invalid handles stay unlinked. Existing account grants, traffic calculations and publishing behavior remain intact.

## Files changed
Dashboard backend and client, their focused tests, generated asset manifest, CURRENT_STATE and this handoff.

## Tests performed
44 focused dashboard/backend/client/layout/asset tests passed, zero failures or skips. Coverage includes all four traffic tiers, stale/missing/invalid handles, private account exclusion, escaped labels, read-only requests and retained local detail behavior. Asset manifest and git diff checks passed.

## Release
Runtime commit 1162169a0c992c162b1940ca4ee74bbc8f6d968a pushed to GitHub main. Clean main release checkout matched origin/main before npm run deploy. Worker version 6799a378-c659-44fb-97f2-af2d860e9930 deployed to factory.tiktokaitool.com.

## Unfinished work
None. Unsynchronized handles require the existing account sync before a reliable link can be shown.

## Recommended next step
Open automatic operations → account traffic and click any synchronized account name.

## Production verification
Authenticated automatic-operations UI exposed native profile anchors. The eight strong-traffic rows all linked to their synchronized profiles. Clicking vnhlanvy910 opened a new TikTok tab at https://www.tiktok.com/@vnhlanvy910 while keeping the original factory tab and its modal closed. The right-hand detail button subsequently opened the local account dialog for that same account. The owned browser session was closed after verification; no publishing or configuration mutation was performed.
