# Rewrite comment reference

## Goal and decisions
Use top-liked comments as reference for the selected rewrite model, including Sonnet 5. Keep 10–20 in the library but send at most five distinct positive-liked comments, sorted by likes, with original text and like counts. Shared single/batch prompt path covers all configured models. Fewer available comments are used as-is; missing comments do not prevent rewriting.

Comments inform audience emotions, questions and micro-situations. Prompt treats them as untrusted quoted data, not instructions or clinical evidence, disallows verbatim copying/personal identifiers, and keeps original meaning primary. No change to model selection, collection rules or stored comments.

## Files changed
- factory-cloud/src/psychology-copy-generation.js
- factory-cloud/src/psychology-copy-ai.test.js
- docs/CURRENT_STATE.md, docs/psychology-peer-hits-api.md

## Tests performed
673 full-suite tests passed; git diff --check clean. Mocked actual single and batch API calls verify ranked five comments with counts, duplicate/zero/unknown likes handling, unmodified stored comments and zero/one-comment cases. No live paid model or publishing API calls.

## Next step
Ship via main and npm run deploy. For editorial quality, compare generated drafts using actual imported comments; this change does not promise higher traffic.
