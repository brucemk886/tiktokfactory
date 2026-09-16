# MiniMax H3 in AI video creation

## Goal
Add Kie MiniMax H3 to the factory AI creation video page with a model selector.

## Decisions
- Text-to-video first: `minimax-h3/text-to-video` via the existing Kie createTask and recordInfo endpoints and server-only KIE_API_KEY.
- Keep Grok as the backward-compatible default. Model-specific controls reset incompatible settings when switching.
- MiniMax validates 4–15 integer seconds, 768P/2K, supported aspect ratios, and a 7000-character prompt limit before a paid request.
- Shared request builder serves cloud and local paths. Existing image/analysis and recreation workflows are unchanged.
- Creation history stores and labels the actual model, and retains video preview/download links.

## Files changed
- scripts/kie-video-models.js and tests
- scripts/kie-ai.js and tests
- factory-cloud/src/kie.js, ai.js and ai.test.js
- factory-cloud/package.json
- public/ai.html and public/ai.js
- docs/CURRENT_STATE.md

## Tests performed
- Full factory suite: 326 passed, zero failed/skipped.
- Covers exact MiniMax request payload, numeric duration, unsupported model/settings rejection before billing, persistence, polling, result URL, credits, terminal-state polling, and existing Grok defaults.
- git diff --check passed.

## Unfinished work
Production deployment and browser generation verification follow this commit.

## Recommended next step
Deploy only from a clean checkout matching GitHub main using factory-cloud npm run deploy, then check model switching and one short MiniMax generation online.
