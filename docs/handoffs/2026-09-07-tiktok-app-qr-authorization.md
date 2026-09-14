# TikTok App QR authorization

Implemented locally in sibling D:/cursor/tiktokaitool; no Local Factory application code changed.

Goal: Add a TikTok App QR authorization entry and safe cross-device callbacks.
Decisions: owner-scoped expiring requests, encrypted pending tokens, explicit desktop account confirmation; existing browser OAuth preserved.
Files changed: sibling authorization UI/services/routes, D1 schema/migration 0030, hourly cleanup, dependencies and tests.
Tests: TypeScript and targeted ESLint passed; production build and 78 tests passed, including 12 new authorization tests.
Unfinished: no commit/push/deployment or remote migration; real TikTok App validation pending. Existing unrelated working changes preserved.
Recommended next step: prepare clean reviewed main, push before the prescribed sibling deployment command, then perform App scan verification.
Full handoff: D:/cursor/tiktokaitool/docs/handoffs/2026-09-07-tiktok-app-qr-authorization.md

## Production release — 2026-09-07
- User explicitly requested deployment.
- GitHub main commit: 9c702e49cff712379ca0faa935ee88196c1f0528.
- Before deployment: clean worktree and exact HEAD == origin/main verified by npm run cloudflare:deploy.
- Prescribed deployment command completed successfully from D:/cursor/tiktokaitool.
- Migration 0030_tiktok_qr_authorizations.sql applied successfully.
- Cloudflare Worker version: 2ccceda9-9c6a-4bef-8601-5cbc21dd9897.
- Site: https://tiktokaitool.com/.
- Verification: production health 200; unauthenticated QR GET/POST 401; cross-origin QR POST 403; no-store responses.
- Exact release build and all 78 tests passed. Six pre-existing files remain byte-for-byte unchanged; prior dirty indicators were Git line-ending/stat metadata only.
- Remaining: user must scan with TikTok App to verify provider-side authorization and confirm the displayed account; no real TikTok grant or publishing request was executed by the agent.

## Production follow-up: refresh recovery
- Cause observed: phone callback reached ready for the reported account, but desktop was back to initial component state with no confirmation card.
- Fix: owner-scoped automatic recovery of ready/confirming authorizations after refresh or navigation, including callbacks arriving later; immediate account username/display-name save on confirmation; clearer mobile pending-confirmation title.
- Validation: TypeScript, targeted lint, production build and 81/81 tests passed. Three new regressions cover recovery ownership, delayed callback and expiry.
- Commit: 1f60dab (GitHub main synchronized and clean at deployment).
- Deployed using sibling npm run cloudflare:deploy; first attempt had a transient network failure; retry succeeded without schema changes.
- Cloudflare version: 6d5878fa-3cd1-4a9d-adf6-5f4524608991.
- Post-release health 200; new dashboard asset 200 and includes recovery logic.
- Remaining: user refreshes Account Authorization and confirms the account. Expired requests require a fresh scan; no token expiry was extended or bypassed.

## Final flow: automatic mobile binding
- User explicitly requested removal of desktop confirmation.
- Mobile callback now completes connection persistence before rendering success, resolving active owner from the original server-side request only.
- Desktop manual confirmation removed; old unexpired ready records auto-complete via authenticated POST; pending and completed sessions recover after refresh.
- Source: sibling lib/tiktok-qr-session.ts, lib/tiktok-qr.ts, app/tiktok-qr-connect.tsx, tests/tiktok-qr-session.test.mjs.
- Validation: TypeScript, targeted ESLint, production build and 84/84 tests passed. No real publishing APIs called.
- GitHub main commit 8a83112; prescribed deployment ran from clean exact main; no D1 schema changes.
- Production version: 2b33a9ee-f204-4668-a228-3d2067b2efa3.
- Remaining: live mobile scan validation; expired earlier grants require a fresh QR. No desktop confirmation is needed.
