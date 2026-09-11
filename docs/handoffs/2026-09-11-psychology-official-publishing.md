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

## Release outcome
User requested 上线. Runtime commit `ee52765` was pushed to main; deployment used factory-cloud `npm run deploy` after clean HEAD == origin/main verification. No migrations required. Cloudflare version: `14c63c06-c46f-41d7-a95a-3543c7144811`.

264 tests passed. Live authenticated page verification returned aspect 9:16, no aspectPromptTitle, no phoneList, official link `/psychology-publish`, and zero `/api/geelark/` resource requests. Health returned 200. No real generation or publishing was triggered; browser session closed. Original dirty checkout and running workers remain untouched.

Release checkout: `D:/cursor/localfactory/work/psychology-directory-release`. No remaining work for this request.
