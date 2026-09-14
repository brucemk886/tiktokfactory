# Scoped factory sync production release — 2026-09-07

## Goal
Merge latest main with business-scoped factory archives and recent-video synchronization, then publish both cloud services.

## Release
- Factory main ee83f4b, version 083e4e3c-3f09-48f4-97a9-2071ced086a0. Released first with npm run deploy from factory-cloud in clean release clone D:/cursor/localfactory/work/factory-release.
- Desk main 231fde6, version 55412e17-3e7f-4fcb-8fc7-54aa0045dfff. Released with npm run cloudflare:deploy in clean main checkout D:/cursor/tiktokaitool/work/scoped-release.
- Both clean release copies matched origin/main. Original workspaces pulled updated main while retaining other tasks' uncommitted files.

## Decisions and fixes
Preserved latest customer isolation and upload/publishing fixes from 006840e. Resolved import/test-list merge conflicts by retaining both branches. Factory business assignments authorize analytics regardless of legacy desk owner; pre-assignment identity discovery remains limited to permitted owners. Added actual SQLite query tests for this distinction and corrected SQL subquery grouping. Added await to factory bridge routing so authentication failures return 401 instead of escaping as Worker exceptions.

## Validation
- Desk build, TypeScript and 104 tests passed.
- Factory 224-test full suite passed; subsequent Worker authentication test passed with the focused scope tests (225 total now).
- Live factory scope: 53 business-linked canonical keys, authenticated 200 and unauthenticated 401.
- Live desk directory: 54 identities, 53 linked. First archive page: 20 accounts, all linked, HTTP 200. Unlinked identity analytics request: 404.
- Both cloud /api/health endpoints returned 200 and ok:true.
- No real TikTok publish calls, uploads or account deletions were used as tests.

## Result
Cloud factory accepts only explicit business-linked account analytics; desk applies the same boundary before transfer and on private bridge reads. Recent-video jobs run every two hours at even Beijing hours :15, updating videos strictly younger than 24 hours. Daily full sync remains Beijing 07:00; manual/recovery flows remain. Older video data is preserved during partial R2 updates. Existing unrelated historical blobs are not destructively purged.

## Local-process limitation
The local archive timer code has been pulled, but the running local server was not restarted: its workspace contains unrelated pending changes and active workloads must not be interrupted. Cloud factory receives updates immediately through its push queue; the separate local archival process picks up its new two-hour timer on its next safe restart. Daily history granularity is unchanged.

## Next step
Observe the next scheduled recent-video pass. Restart the separate local archival service only after pending local work is reviewed and no rendering/publishing jobs will be interrupted.
