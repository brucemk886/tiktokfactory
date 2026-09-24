# 2026-09-24 AI rewrite draft generation

## Goal
Add AI 生成 to the source-bound 新增改写文案 dialog, using the factory's existing DeepSeek configuration.

## Decisions
- Reuse createDeepSeekClient and its current deepseek-flash model alias; API keys stay server-side.
- POST /api/psychology-creative/copies/generate?sourceId=... reads completed source text from D1; client text cannot substitute the source.
- Return one unsaved draft (version name, title, caption, 1–6 pages). Photo output preserves the original page count; video output is ordered script sections. Preserve source language and meaning with fresh psychology-focused phrasing.
- Validate provider JSON, field lengths, page count and non-tag-only body. Error responses never expose provider secrets.
- Existing admin/module and Origin checks apply. Generation does not insert variants, create jobs or publish.
- UI locks generation/save/source switching while pending, confirms overwriting an existing draft, keeps the draft on failure, and clears review approval after successful generation. Explicit review/save uses the existing source-bound version flow.

## Files
- factory-cloud/src/psychology-copy-generation.js (new)
- factory-cloud/src/psychology-creative.js and .test.js
- public/psychology-copy-library.html and .js
- scripts/psychology-copy-library-ui.test.js

## Validation
- Full factory suite: 653/653 passed; git diff --check passed.
- Covers photo/video generation, current model contract, no writes/jobs, authorization/Origin/source validation, malformed provider output, failure preservation, duplicate clicks, source switching and review/save gating.

## Next step
Commit/push main, standard npm run deploy, then generate one unsaved production draft through the UI to verify the real provider and form fill.
