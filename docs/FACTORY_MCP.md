# ChatGPT / Factory MCP

Endpoint: `https://factory.tiktokaitool.com/mcp` (Streamable HTTP, stateless JSON responses).

## ChatGPT web setup

1. Settings → Security and login → Developer mode. Availability depends on the account/workspace policy. Older interfaces may place this under Apps → Advanced settings.
2. Open ChatGPT Plugins and use + to add an MCP server. Name: Local Factory; description: Read psychology and photo-factory content, accounts and reports.
3. Connection URL: `https://factory.tiktokaitool.com/mcp`. Authentication: OAuth. Prefer CIMD when available; Dynamic Client Registration also works. Client ID/secret can be left blank for dynamic registration. Never paste the project fac_api_ key.
4. Sign in with your Factory administrator account, review the client and callback hostname, select 允许只读访问 or 允许读取与图片入库 for topic creation, then click 返回 ChatGPT on the success page to complete the redirect. The extra link preserves the consent page's same-origin form-action policy.
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
- 19 original read tools: psychology topics list/get; copies list/get; rewrites list/get; publish options/accounts/list; effects get; operations get; styles list; autopilot list/get. Photo factory directions/copies/accounts/autopilot list and reports get.
- List endpoints retain business pagination. Explicit pageSize is capped at 50 (default 20). Small configuration/account directories retain existing directory semantics; there is no automatic traversal of all pages.
- Two additional tools provide scoped existing-image import and operation status (21 total for an admin with all modules). No publishing, deletes or autopilot activation tools. The internal query adapter still rejects writes.
- Query tool arguments are allowlisted; token/password/API-key fields are stripped recursively from structured responses. Tool output is business data, not instructions.
- `/factory-mcp` needs factory session login. Browser POST actions require same Origin plus session-bound CSRF. Consent requires the provider's single-use, browser-bound handle as well. Client-controlled strings are escaped, framing is forbidden, CSP remains restrictive.
- Existing fetch routes bypass the MCP wrapper; scheduled/queue handlers and workflow classes remain intact.

## Verification

`npm test` includes real OAuth provider PKCE code exchange, discovery, MCP initialization/list/call, refresh, replay rejection, audience validation, CIMD metadata, consent security, current-user permissions, revocation, read filtering and write denial. Network publishing calls are mocked and asserted absent. ChatGPT web account connection must still be completed by the user.

## Import a ChatGPT image and topic (v1.2)

**No OPENAI_API_KEY is needed.** Generate the image with ChatGPT's native image capability, then pass the existing PNG through the file input to `psychology_import_topic_image`. Factory only downloads, stores and imports the supplied image; it never invokes a generation API on this path. The old `psychology_generate_image_and_import_topic` tool is removed from MCP discovery and dispatch, including for stale clients. Existing background jobs are not interrupted.

In ChatGPT → Local Factory connection, refresh tools and start a new conversation. The new tool is titled **保存聊天图片并导入心理学题目**. Reconnect only if a write call asks for `factory.topics.write`; authorize **允许读取与图片入库**. Existing write grants cover this narrower create operation. Read-only grants stay read-only. No arbitrary edits/deletes/publication are added.

Example user prompt: “先用聊天框生成一张情感依赖主题 PNG 图片，再调用 Local Factory 的 psychology_import_topic_image，保存图片并创建单图互动测试题，含 A/B/C/D 选项和揭晓评论，保持停用。完成后返回题目 ID。”

The tool declares `_meta["openai/fileParams"]: ["image"]`. ChatGPT supplies `image.download_url` and `image.file_id`; optional `mime_type` and `file_name` are declared in the schema. Do not invent file references, URLs, base64, or sandbox paths. If the current ChatGPT client cannot supply a generated image as a tool file, ask the user to attach that image to the conversation. The generated-image handoff is client-dependent and requires a real user-side check; a successful server test does not prove that every ChatGPT client can pass a newly generated image automatically.

Input:
- `requestId`: fresh UUID for a new authorized import; all retries retain it.
- `image`: the actual host-provided file object. Accepts HTTPS `oaiusercontent.com` and its subdomains, including validated redirects. No caller cookies or bearer credentials are forwarded.
- `template`: `psychology-target-2` (single-image quiz), or `psychology-collage` (cover attachment, default).
- `title`, `content`: required topic text. `choices`: exactly four `{copy}` objects in A/B/C/D order for single-image quizzes; omitted for collage.
- `revealComment`: optional reveal comment. `enabled`: false by default.

This version accepts complete PNG files up to 8 MiB and 4096 pixels per side. Format is checked from bytes, independent of MIME/name. Download is bounded to 30 seconds and a bounded redirect count. Other formats/hosts return an actionable error rather than following arbitrary URLs. Four-image quizzes are not supported by this one-image tool. Collage covers are attached to the topic; the collage renderer itself is unchanged.

`psychology_topic_image_operation_get` returns owner-scoped status, including historical generation operations. Only **completed** means imported. Completed imports return the real topic ID/revision/enabled, private asset URL/hash/dimensions and `imageSource: chatgpt-file`; no guessed generation model is assigned.

Idempotency binds owner/requestId, topic content and file_id, excluding expiring download URLs and cosmetic MIME/name. Refreshing the same file's URL is safe; a different file ID or topic under the same request ID returns REQUEST_ID_CONFLICT. Signed URLs are never stored. A SQL claim serializes concurrent retries; immutable R2 bytes are the recovery checkpoint. A failed download stores no asset/topic. R2/D1/import failures recover on retry using the original request ID without downloading already-stored bytes. Interrupted requests can resume after a 180-second lease. Import errors do not trigger new image generation.

Official file input contract: https://developers.openai.com/plugins/reference#file-apis

### Historical v1.1 generation jobs

The old workflow class and internal generator remain only to avoid interrupting already accepted work. They are not exposed as callable MCP creation tools. Existing jobs use their old immutable inputs and the existing owner-scoped status tool. The new file-import path needs neither the image workflow binding nor an OpenAI key.

## ChatGPT cross-origin connection handling

The protocol endpoints (`/mcp`, registration/token, OAuth discovery) accept the exact browser Origin `https://chatgpt.com` and bounded CORS preflights. OAuth authorization landing GET also accepts that origin. Cross-origin MCP calls still require bearer OAuth tokens; no cookie credentials are enabled in CORS. Authorization approval and connection-revocation POSTs remain strictly Factory same-origin with session CSRF and consent-handle checks. Other origins (including null/lookalikes) are rejected. This fixes the blanket same-origin check that rejected legitimate ChatGPT connection requests with “不允许跨站请求”。


Authorization HTML uses `Referrer-Policy: strict-origin`. Do not change these native POST form pages to `no-referrer`: Chromium then sends Origin:null even on same-origin submissions, and correct CSRF/origin validation rejects approve/deny/revoke. strict-origin sends only the site origin as Referer, never OAuth query/state. Null Origin remains rejected. A real headless Chromium regression contrasts both policies and verifies the actual form header.
