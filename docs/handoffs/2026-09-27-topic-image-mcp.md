# Topic image MCP

## Goal
One ChatGPT operation calls OpenAI official image generation, stores an owned R2 asset, and imports a linked psychology topic, with defaults disabled and safe retries. User will configure the OpenAI secret later.

## Decisions
- Official Image API gpt-image-2, n=1 medium PNG; explicit extra OAuth factory.topics.write, read tokens unchanged.
- Durable Workflow and D1 claim, no automatic paid retry. Deterministic R2 key + metadata recovers storage/registry interruptions. Existing importer fingerprint guards repeated imports; actual accepted/items schema checked (attachment's results[] shape does not match this repo).
- Stable downstream importRequestId is audit-only, not an external requests.get receipt. Recovery through operation status and same tool input/requestId.
- Collage cover attachment and true single-image test supported; four-image tests excluded. Private preview URL requires factory login, no public CDN or complex asset manager.
- Revocation/current topic-bank permissions rechecked; secret missing fails before queueing.

## Files changed
factory-cloud migration0066; topic-image-operation.js/test, topic-assets.js; topic-bank backend/tests and shared normalizer; MCP routes/tools/tests; entry/workflow binding; API catalog; topic-bank cover preview and asset manifest; related docs and npm test list.

## Validation
Focused tests cover async success, defaults, single-image rendering key, UUID conflicts/concurrent start, scope/ownership isolation, permission revocation, provider ambiguity, durable R2 recovery, import retry, and large asset pages. `npm test` in factory-cloud: 856 passed, 0 failed. UI asset manifest regenerated and git diff --check passed.

## Unfinished / next step
User must add OPENAI_API_KEY as a Cloudflare Secret, refresh MCP metadata, reauthorize the write scope, then explicitly test one image and check the disabled topic. No real paid image request made during implementation. Stored collage cover does not alter existing video rendering.

## Deployment
Committed/pushed main acfea02, then deployed using npm run deploy from a clean main checkout exactly matching origin/main. Migration 0066 applied (7 statements). Worker version 05fd81a0-a7de-418a-a61b-d7b05dd73e4d; new factory-topic-image Workflow bound. Live OAuth authorization/protected-resource metadata both return 200 and factory.topics.write. Unauthenticated /mcp still returns 401 with resource challenge. OpenAI generation remains untested live until user configures the secret.
