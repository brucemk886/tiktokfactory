# Psychology Gemini 3.8 Default

## Goal

Use Kie Gemini 3.8 Flash as the default text model across all psychology templates.

## Decisions

- Local Kie chat defaults to `gemini-3-8-flash-openai` for collage and interactive planning.
- The four-image local fallback uses the same Gemini 3.8 endpoint for narration and image-prompt generation.
- The hosted `/api/kie-ai` endpoint accepts synchronous admin-only chat generation and stores the result in the existing AI generation history.
- Z-Image remains the image model; rendering locations are unchanged.

## Files changed

- `factory-cloud/src/kie.js`, `factory-cloud/src/ai.js`
- `scripts/kie-ai.js`, `scripts/psychology-video-job.js`
- `public/psychology.js`
- Focused tests and current-state documentation

## Tests performed

- `npm test` from `factory-cloud`: 338 passed, 0 failed.

## Unfinished work

- None expected after deployment verification.
