# Psychology portrait default and official publishing

## Goal
Default the four-image template to 9:16, remove the yellow aspect text and GeeLark publishing area; psychology publishing uses official APIs.

## Decisions / files
- `public/psychology.html`, `.js`, `.css`: portrait default, removed aspect note and whole third-party publishing form/account requests/validation. Generation and preview use official provider with autoPublish false. A link leads to existing `/psychology-publish` for selecting authorized accounts and finished videos. Collage and interactive templates already have no GeeLark form.
- Cloud `compat.js`: persisted old default aspect becomes 9:16 until an explicit new preference is saved (`aspectRatioPreferenceVersion: 1`); newly selected landscape remains valid. New psychology tasks have module psychology, official provider and no legacy account IDs. Legacy retry-publish asks users to choose official accounts; explicit official retries recheck project account permissions.
- New `scripts/psychology-publish-policy.js`, used by cloud jobs at request handling, enqueue and worker delivery: legacy/missing third-party publishing becomes generation-only, never converts GeeLark IDs to official IDs. Explicit official settings are retained and normal authorization still applies. Other business types are unchanged. Existing running jobs were not interrupted.
- `scripts/psychology-video-job.js` fallback aspect is 9:16 when payload omits it; explicit 16:9 still works.
- Added focused tests to `factory-cloud/src/psychology-module.test.js`; updated CURRENT_STATE.

## Verification
All 264 factory tests passed. Tests cover old queue payload delivery, sparse defaults/preference save, psychology API generation-only storage, legacy retry rejection and unaffected other providers. Actual frontend test `work/check-psychology-official.mjs` verified 9:16 from legacy defaults, no yellow note/third-party controls/requests, generation-only payload, saved landscape, and actual official publishing page payload with mocked APIs. Screenshot inspected. No real generation, TTS or publishing APIs were called.

## Status / next step
Changes are uncommitted in `D:/cursor/localfactory/work/psychology-directory-release`, not deployed. Production is still workbench runtime 2a98fca / Cloudflare 9fbe5054-0b16-4355-816b-f8a0cf2b9db0 (main includes docs commit 887b8fe). On user deployment instruction: commit/push main, clean HEAD == origin/main, factory-cloud `npm run deploy`, live read-only verification. Original dirty checkout/workers remain untouched. No database migration or worker restart is required for cloud payload enforcement.
