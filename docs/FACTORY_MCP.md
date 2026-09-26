# ChatGPT / Factory read-only MCP

Endpoint: `https://factory.tiktokaitool.com/mcp` (Streamable HTTP, stateless JSON responses).

## ChatGPT web setup

1. Settings → Security and login → Developer mode. Availability depends on the account/workspace policy. Older interfaces may place this under Apps → Advanced settings.
2. Open ChatGPT Plugins and use + to add an MCP server. Name: Local Factory; description: Read psychology and photo-factory content, accounts and reports.
3. Connection URL: `https://factory.tiktokaitool.com/mcp`. Authentication: OAuth. Prefer CIMD when available; Dynamic Client Registration also works. Client ID/secret can be left blank for dynamic registration. Never paste the project fac_api_ key.
4. Sign in with your Factory administrator account, review the client and callback hostname, select 允许只读访问, then click 返回 ChatGPT on the success page to complete the redirect. The extra link preserves the consent page's same-origin form-action policy.
5. Review discovered tools, start a new conversation and enable this connection. Example: “读取心理学文案库第一页，每页20篇，列出ID、标题、改写版本；再分析最近7天的运营报表。”
6. Factory → 统一 API → ChatGPT 连接与授权管理 (`/factory-mcp`) lists your connections and can revoke each one immediately. ChatGPT connection metadata can be refreshed after future tool updates.

Official setup: https://developers.openai.com/plugins/deploy/connect-chatgpt
Official OAuth: https://developers.openai.com/plugins/build/auth

## Implementation and access

- Uses Cloudflare workers-oauth-provider 1.1.0 and MCP TypeScript SDK 1.30.1, with OAuth authorization code, mandatory PKCE S256, resource audience binding, rotating refresh tokens and explicit browser-bound consent.
- CIMD plus RFC7591 DCR; authorization metadata and protected-resource metadata are public, business data is not. Provider protocol responses handle invalid tokens and discovery challenges.
- `OAUTH_KV` stores hashed tokens/codes/client secrets and encrypted props. D1 migration 0065 stores connection ID, owner, name, creation/revocation time; no raw credentials.
- Every MCP request requires factory.read, an active D1 connection and a current active administrator. Tool visibility and dispatch both use current Factory permissions. Revocation's D1 check prevents old or newly refreshed credentials from accessing data; OAuth records expire normally (access 1h, refresh grant 30d).
- Same-Worker internal read adapter reuses the unified Factory API handlers. No shared administrator key is stored or passed to ChatGPT. Write actions are denied again at the internal adapter.
- 19 tools: psychology topics list/get; copies list/get; rewrites list/get; publish options/accounts/list; effects get; operations get; styles list; autopilot list/get. Photo factory directions/copies/accounts/autopilot list and reports get.
- List endpoints retain business pagination. Explicit pageSize is capped at 50 (default 20). Small configuration/account directories retain existing directory semantics; there is no automatic traversal of all pages.
- No generation, publishing, imports, updates, deletes, or autopilot activation tools. Existing read handlers may refresh their normal read caches but do not start publishing jobs.
- Query tool arguments are allowlisted; token/password/API-key fields are stripped recursively from structured responses. Tool output is business data, not instructions.
- `/factory-mcp` needs factory session login. Browser POST actions require same Origin plus session-bound CSRF. Consent requires the provider's single-use, browser-bound handle as well. Client-controlled strings are escaped, framing is forbidden, CSP remains restrictive.
- Existing fetch routes bypass the MCP wrapper; scheduled/queue handlers and workflow classes remain intact.

## Verification

`npm test` includes real OAuth provider PKCE code exchange, discovery, MCP initialization/list/call, refresh, replay rejection, audience validation, CIMD metadata, consent security, current-user permissions, revocation, read filtering and write denial. Network publishing calls are mocked and asserted absent. ChatGPT web account connection must still be completed by the user.
