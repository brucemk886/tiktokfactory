# ChatGPT image attachment → topic import

## Goal
User wants ChatGPT native image quota, not a separately billed API generator. Replace the exposed paid generation tool with existing-image import.

## Decisions
- New psychology_import_topic_image declares the complete OpenAI file schema and openai/fileParams metadata. Old generation tool removed, so stale clients cannot invoke it. Existing workflow jobs are preserved.
- No OpenAI key or generator/workflow calls on file path. Reuses private R2 assets, existing topic validation/import and operation table, no migrations. PNG up to 8 MiB / 4096 pixels. Collage cover or single-image quiz, default disabled.
- Narrow HTTPS OpenAI file-host validation including every redirect, bounded reads/timeouts, no forwarded credentials. Signed download URLs never stored or exposed in errors. Fresh URL for same file ID is accepted without changing the request fingerprint.
- SQL claim and immutable R2 checkpoint cover concurrent requests, lost acknowledgement and retries; topic importer retains fingerprint idempotency. Active admin/topic permissions rechecked before writes. Read-only OAuth cannot write.
- ChatGPT must supply a real file reference. Native generated-image availability varies by client: fall back to user reattaching PNG. Do not promise full ChatGPT end-to-end automation based on mocked tests.

## Files
factory-cloud/src/topic-file-import.js and .test.js; factory-mcp-tools.js; factory-mcp.js; factory-mcp.test.js; topic-image-operation.js; package.json; docs/FACTORY_MCP.md; docs/CURRENT_STATE.md.

## Verification
35 focused tests passed: actual OAuth/MCP file schema and call without key/workflow, disabled topic creation, quiz image binding, retries, stale lease, URL/redirect rejection, bounded/invalid images, permissions and secret handling. Full factory suite: 871 passed, 0 failed. No real generation or publishing calls.

## Deployment
Code commit 437e0bb pushed to GitHub main and deployed with npm run deploy from clean release main exactly matching origin/main. Worker version beb1c8ea-dae6-48f6-beed-762ec271cfa2. No migrations required. Live checks: discovery 200 with factory.read/factory.topics.write; unauthenticated /mcp 401; authorization page retains strict-origin.

## Remaining user step
User refreshes Local Factory tools, starts a new chat and passes a real PNG attachment. This final ChatGPT-side generated-image handoff remains unverified. Existing write authorization suffices; read-only users must consent to image import.
