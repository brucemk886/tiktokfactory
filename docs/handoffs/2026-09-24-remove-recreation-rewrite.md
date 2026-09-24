# 2026-09-24 Remove original-recreation rewrite toggle

## Goal
Remove the copy-library toolbar's 改写文案 checkbox and its associated original-recreation behavior, as requested in the screenshot.

## Decisions / Changes
- Removed the checkbox, media/access visibility handling and frontend rewriteCopy request field.
- Manual peer recreation endpoint no longer accepts input.rewriteCopy as a generation option; new photo recreations keep the original text even when an old client sends true.
- Existing copy-library rewrite versions, manual version creation and shared execution support for previously created jobs remain intact. No jobs were interrupted and no stored data was deleted.
- Changed public/psychology-copy-library.html, public/psychology-peer-hits.js, public/psychology-peer-production.js and factory-cloud/src/psychology-peer-production.js, plus relevant UI/route tests.

## Validation
- npm --prefix factory-cloud test: 649/649 passed.
- UI behavior tests verify both media tabs submit no rewrite option; backend regression verifies legacy true cannot enable rewriting for newly created manual recreations.
- git diff --check passed.

## Deployment / Completion
- ed68fe6 committed and pushed to main; clean HEAD == origin/main verified before standard factory-cloud npm run deploy.
- Production version: 43072507-7fd1-4b31-af1d-7cb08358d4d0.
- Read-only browser verification on the 10-row photo list confirmed 改写文案 absent, with 原帖复刻, 全选本页, 批量删除 and row 新增改写 retained. No production jobs created or data changed.
- Complete; no remaining work.
