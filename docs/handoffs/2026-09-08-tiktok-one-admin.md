# TikTok One integration — 2026-09-08

Goal: add an administrator-only TikTok One module to the hosted middle platform.
Implementation is in sibling repository D:/cursor/tiktokaitool, which was clean before this task. Existing localfactory work was preserved.
See D:/cursor/tiktokaitool/docs/handoffs/2026-09-08-tiktok-one-admin.md for files, verified official endpoints, security decisions, tests and activation instructions.
Delivered local code: TTO OAuth, encrypted account connections, anchors and campaigns, video/anchor metrics, legacy order audit query and confirmed rejection. Full build + 174 tests and TypeScript pass. Local mocked desktop preview inspected.
Unfinished: commit/push/deploy, administrator brand-account OAuth, real-account read validation, and confirmation of new TTO project compatibility with legacy audit endpoints. No automatic approval, direct publishing or production changes performed.
Next step: release under sibling repository deployment rules, then connect the administrator's TTO brand account and verify a known project report.

## Production release completed
User explicitly requested deployment. Committed and pushed sibling main as 5b87f7b7e5dd983e94ace7d9b44fe6141cac8588. Ran only npm run cloudflare:deploy; its guard confirmed clean HEAD == origin/main. D1 migration 0037_tiktok_one.sql succeeded; Cloudflare version 456677f8-8453-458c-a605-39938147f7d6 deployed to tiktokaitool.com. Post-release checks: homepage HTTP 200, unauthenticated /api/admin/tiktok-one HTTP 401 and Cache-Control no-store. Sibling worktree remains clean and synchronized. Administrator OAuth and real TikTok account data checks remain pending user login; no real TikTok mutations were performed.

## OAuth runtime fix released
After administrator reported the authorization callback error, reproduced workerd rejecting redirect:error before network dispatch. Changed to manual (redirects still rejected), added fresh-authorization-specific error, and passed build + 176 tests including Miniflare runtime regression and tsc. Commit 71cc954 pushed to main. First deployment uploaded code but hit a network error updating triggers; reran npm run cloudflare:deploy successfully, version 709b6f4a-44e5-4cfc-818e-9d28e1c18820. No new migrations. Administrator must start a new OAuth connection; prior state is consumed. Real-account authorization completion still requires user retry.

## Report defaults released
User requested default 90 days and audit-account clarification. Implemented inclusive last 90 UTC dates, campaign-creation clamp and effective date display, preserving official metric semantics. Clarified legacy TCM account input. Build + 178 tests, TypeScript and focused ESLint pass. Pushed main 8cb1704; npm run cloudflare:deploy succeeded, version 191dbd04-4b01-4fa3-b98f-06f8969a6f01. No production schema or TikTok business mutations. Detailed handoff is sibling docs/handoffs/2026-09-08-tiktok-one-date-default.md.
