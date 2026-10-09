# Direct REST guide for Dot — 2026-10-09

## Goal
User chose the existing Grokbot HTTP API path for Dot and requested a document to hand over for a one-item test.

## Decisions
- Rewrite the canonical public guide to lead with direct REST + project Bearer key. No runtime endpoint, auth, key or importer change.
- Complete one-item original/recreation image workflow with create, real-byte upload/status, frame/version writes, revision handling, request receipt recovery, private image readback and result links. Dot explicitly sends importSource gpt-dot and leaves enabled false.
- Supply standard-library Python request/upload examples. UUIDs must be saved before transmission; unchanged retries preserve IDs and parameters. No production test content or publication.
- Distinguish missing HTTP execution capability, missing credentials and actual API denial. Do not send users back to MCP refresh for a direct REST task. Keep MCP mapping as an optional last appendix for existing guide consumers.

## Files changed
Canonical and generated public psychology-video-hits-api.md, CURRENT_STATE, this handoff.

## Tests performed
Focused API/MCP/private asset/public-guide suite: 69/69 passed. All 10 JSON request examples in the new walkthrough parsed; both Python examples compiled without executing requests. Generated public document matches the canonical source. Deployed public guide returned HTTP 200 and matched the canonical generated file byte-for-byte.

## Unfinished work
Dot's external runtime must have HTTP execution, real source/images and the user-authorized project key to run the one-item import; no success is claimed for that session.

## Recommended next step
Give Dot the public guide, request the single-item REST walkthrough with importSource gpt-dot and readback, then review the resulting source/detail link.

## Release evidence
Commit 94b08a7 was pushed to main, then deployed from a clean exact HEAD == origin/main checkout with factory-cloud npm run deploy. Cloudflare version 5d8a36d1-33cc-49db-bf2f-f6a6cd88b230. No schema, key, endpoint or running-job changes. Live public document matches the released REST-first guide.
