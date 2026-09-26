# Factory read-only MCP

## Goal
Connect ChatGPT web to existing Factory data using OAuth, with user-facing setup instructions.

## Decisions
- 19 named read tools only; reuse internal unified API handlers and current user permissions, never a shared fac_api_ key.
- Cloudflare OAuthProvider 1.1.0, MCP SDK 1.30.1; PKCE S256 mandatory; CIMD and DCR; dedicated OAUTH_KV.
- Explicit browser/session-bound consent. Preserve same-origin form-action CSP; approval success offers a direct return link to the validated client callback.
- Migration 0065 stores connection ownership and revocation in D1 for immediate enforcement independent of KV propagation.
- Existing root worktree edits were preserved; implemented in work/factory-mcp on codex/factory-mcp based on origin/main 1885d2e.

## Files
New factory-mcp.js, factory-mcp-tools.js and tests, migration 0065; entry.js wrapper and factory-api.js read adapter; package/lock/wrangler; factory-api.html connection link and narrowly allowlisted login return; asset manifest and docs.

## Tests
Full npm test suite and focused OAuth/MCP tests. Real provider code exchange/refresh/consent and MCP requests with mock KV/D1, no live publishing APIs. Native Windows wrangler dev announced ready but local HTTP requests timed out; production smoke checks are required after deployment. npm audit's production findings belong to the existing puppeteer/extract-zip dependency chain, not new MCP/OAuth dependencies.

## Remaining
User completes ChatGPT web developer-mode connection and OAuth approval. No write tools in this release. Instructions in docs/FACTORY_MCP.md.
