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

## Next step
Commit and push main, then standard factory-cloud npm run deploy and read-only online control verification.
