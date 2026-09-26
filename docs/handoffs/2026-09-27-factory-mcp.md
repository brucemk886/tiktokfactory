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
844 tests passed after rebasing onto 6a67457; eight focused OAuth/MCP tests included. Real provider code exchange/refresh/consent and MCP requests with mock KV/D1, no live publishing APIs. Native Windows wrangler dev announced ready but local HTTP requests timed out; production smoke checks are required after deployment. npm audit's production findings belong to the existing puppeteer/extract-zip dependency chain, not new MCP/OAuth dependencies.

## Remaining
User completes ChatGPT web developer-mode connection and OAuth approval. No write tools in this release. Instructions in docs/FACTORY_MCP.md.

## Production verification
- Implementation commit efba7d7 pushed to main before deployment from a clean main release clone; deployed through npm run deploy.
- Worker version 6e19551f-142b-4bc0-8e32-4af0930f5be4; migration 0065 applied successfully; startup 64 ms.
- /api/health 200; authorization and protected-resource discovery 200; S256, CIMD and registration advertised; unauthenticated /mcp 401 with correct resource metadata challenge.
- Browser confirmed the administrator connection page and no existing grants. Test Agent Window closed. No production OAuth grant was created, and no business write/publish actions were invoked.
