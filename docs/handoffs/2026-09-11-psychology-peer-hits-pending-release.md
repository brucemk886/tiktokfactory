# Psychology release completed

User explicitly requested “上线” on 2026-09-11. The peer viral-video module and previous psychology Z-Image/topic-library changes are now deployed.

Release checkout: `D:/cursor/localfactory/work/psychology-directory-release`.
Runtime commit: `270716a391700e2635b3aafac2db22b377dacdcb`.
Cloudflare version: `2d3ad1c2-9739-46e9-8c29-be4115c750b7`.
Migration 0022 applied successfully. Deployment used factory-cloud `npm run deploy` after a clean main / HEAD == origin/main check.

All 261 tests passed. Live authenticated peer-hit page loaded its empty D1 list and API-key metadata; unauthenticated writes returned 401; health returned 200. All three psychology template pages show Z-Image and the topic-library navigation entry is removed. No production bot key, sample records, generation jobs or publishing jobs were created during checks.

Read the release checkout handoffs `docs/handoffs/2026-09-11-psychology-peer-hits.md` and `2026-09-11-psychology-zimage.md`; API documentation is `docs/psychology-peer-hits-api.md`. Entry: https://factory.tiktokaitool.com/psychology-peer-hits . The user can generate a key there for grokbot.

The original main checkout has unrelated pending changes and was intentionally not pulled or reset. Existing worker processes were not restarted. Preserve that work; continue production changes in the release checkout or another isolated checkout as appropriate.

## Subsequent UI change pending
User requested one psychology 模板工作台 like mid-video. Implemented in the release checkout, not deployed; see `docs/handoffs/2026-09-11-psychology-workbench.md` there. Includes three cards with unchanged template URLs/permissions, one sidebar entry and parent highlighting. 261 tests and actual-browser navigation/role checks passed. Continue from that checkout.

## Workbench now deployed
User requested 上线. Runtime commit 2a98fca; Cloudflare version 9fbe5054-0b16-4355-816b-f8a0cf2b9db0. No migration needed. Live page shows three cards and one sidebar entry; all 261 tests passed. Latest details are in the release checkout docs/handoffs/2026-09-11-psychology-workbench.md.

## Subsequent psychology publishing cleanup pending
Latest request (9:16 default, remove yellow note/GeeLark form, official-only psychology publishing) is implemented but not deployed in the release checkout. Read its `docs/handoffs/2026-09-11-psychology-official-publishing.md`. All 264 tests and mock-browser generation/official publishing checks passed. No active workers/jobs were stopped.

## Portrait / official publishing cleanup now deployed
Runtime ee52765; Cloudflare 14c63c06-c46f-41d7-a95a-3543c7144811. 264 tests passed. Live page shows 9:16, no yellow note/phone controls/GeeLark requests, and official psychology publish link. Health 200. Latest release handoff: docs/handoffs/2026-09-11-psychology-official-publishing.md in release checkout.
