# Explicit TikTok One membership in psychology publishing

## Goal
Make account-to-project joining a visible, separate action in the factory review flow, before final video publication.

## Decisions
- Existing final-confirmation backend already ensures every chosen account belongs to the exact One project and rejects creation when joining fails. Preserve this gate.
- Add “加入所选项目” plus individual “加入项目 / 重试加入” controls, a confirmation describing the project/account count, per-account state and reasons, and a confirmed/selected count. Confirmed accounts are skipped; changing projects uses distinct cached membership. Unknown status is not presented as definitely unjoined.
- Joining locks editing/publication until the current set finishes. Mixed results remain visible and individual retries do not rejoin confirmed accounts. Joining alone never creates generation or publication jobs.
- New POST on the existing factory One endpoint reloads active admin access, verifies origin and current psychology account scope, normalizes canonical brand/account/project IDs, and calls the existing Hub ensure operation. Invitation links remain server-resolved. Hub duplicate/unconfirmed-operation protections remain in effect.
- Preserve the two requested anchor choices, existing planning pauses and real publication confirmation. Do not auto-enroll any production accounts as part of QA.

## Files changed
- factory-cloud/src/psychology-tiktok-one.js and focused endpoint tests.
- public/psychology-tiktok-one.js; publishing page markup, parent busy-state integration and row styles; generated asset manifest.
- scripts/psychology-selected-ui.test.mjs; current state and architecture notes.

## Tests performed
- 16 focused backend tests passed: scoped explicit join, provider errors, inactive admin, cross-origin and out-of-scope rejection, absence of publication jobs, existing final-confirmation gate and selected-video workflow.
- Browser regression passed using synthetic services: no join on viewing, cancelling join sends nothing, mixed success/failure, individual retry, no repeat for confirmed account, separate project state, no publication on join, and existing desktop/mobile preview and publication confirmation.
- Full regression passed: 1,292/1,292 tests, no failures. Deployment uses the clean-main gate and normal factory deploy script; release version is recorded after completion.

## Unfinished work
No live TikTok project membership or real video publication was changed in tests. The user must validate their actual accounts against TikTok eligibility and provider responses. Previously documented source-worker availability requirements remain.

## Recommended next step
On the selected-video publishing page, choose thousand-follower accounts and one of the two psychology projects, join/check the accounts, resolve any returned errors, and then explicitly confirm a small video batch.
