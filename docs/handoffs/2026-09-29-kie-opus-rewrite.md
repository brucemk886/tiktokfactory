# Kie Claude Opus 4.8 rewrite option

## Goal
Add Kie's claude-opus-4-8 to the copy library.

## Decisions
- Both single draft and batch pickers expose Claude Opus 4.8（Kie）; Sonnet remains the default.
- Reuse KIE_API_KEY and Kie's Claude Messages endpoint, not Replicate/OpenAI chat protocol. Verified https://docs.kie.ai/market/claude/claude-opus-4-8.
- Nonstreaming text-only extraction, thinking disabled, 120-second timeout, 1 MiB response bound. Provider errors, truncated and empty responses fail explicitly; no silent fallback or paid automatic retries.
- Existing review gates, top-comment references and attribution persist through the shared generation/save path. No migration or publishing changes.

## Files changed
factory-cloud/src/kie-claude.js; psychology-copy-generation.js; psychology-rewrite-model.js; psychology-copy-ai.test.js; public/psychology-copy-library.html; docs/CURRENT_STATE.md.

## Verification
75 focused tests passed, covering provider routing/auth, both pickers, single drafts, batch model persistence, response failures and existing library/photo-factory behavior. Production KIE_API_KEY name is present; secret value was not read. No paid generation or publishing performed in tests.

## Unfinished / next step
Feature commit fefee1c was pushed to main and deployed from a clean main checkout with npm run deploy. Initial trigger synchronization had a network failure; the standard deployment retry completed successfully, including all cron and workflow triggers. Live Worker version: 3b2b515a-7e8f-4c69-a3f6-5430d38342a4. Actual paid model generation has not been smoke-tested; first manual generation can validate account credit and provider availability.
