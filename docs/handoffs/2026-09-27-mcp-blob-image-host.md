# ChatGPT image Blob host compatibility

## Goal
Allow the user's existing generated image URL to reach the topic importer without requiring another image or request ID.

## Evidence and decisions
- User reports oaisdmntprwestus.blob.core.windows.net and an outer INVALID_ARGUMENT. The latter is not proof of a specific Factory error. Local reproduction proves the prior URL allowlist rejects this host.
- Add this one exact Azure storage account to the existing HTTPS oaiusercontent allowlist. This is a compatibility exception based on the user's reported handoff, not a verified general OpenAI storage contract. No Azure-wide or regional wildcard; no alternate source URLs are discovered or guessed.
- Preserve redirect-by-redirect validation, no forwarded credentials, 30-second timeout, 8-MiB/4096px PNG checks, current permissions and durable import idempotency. Both UI and direct file import reuse this path; no new tools/schemas or paid generation.
- Include Factory operation error codes in text as well as structuredContent so clients that drop structured errors retain a useful diagnosis. Never expose signed URL paths/queries.

## Files
factory-cloud/src/topic-file-import.js and .test.js; factory-mcp-tools.js; factory-mcp.test.js; docs/FACTORY_MCP.md; docs/CURRENT_STATE.md.

## Tests
29 focused tests passed: reported host import and idempotent replay; exact-host/lookalike/other tenant restrictions; allowed and denied redirects; no stored signed URLs; actual OAuth/MCP visible errors and expired URL reaching download without creating a topic. All networking/storage fixture-based, no publishing or generation calls. Full factory suite: 876 passed, zero failed/skipped.

## Deployment / remaining work
Pending commit, push and deployment. User must retry the original request ID/topic/file using a real current download URL; no access to that ChatGPT session or signed image link here, so actual user image ingestion cannot be claimed complete.
