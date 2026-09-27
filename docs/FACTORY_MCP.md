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
- Five additional tools provide a prepare/picker UI, app-only URL save and byte upload actions, direct file import and operation status (24 total in raw tools/list for an admin with all modules; the two app-only actions are hidden from model discovery by host metadata). No publishing, deletes or autopilot activation tools. The internal query adapter still rejects writes.
- Query tool arguments are allowlisted; token/password/API-key fields are stripped recursively from structured responses. Tool output is business data, not instructions.
- `/factory-mcp` needs factory session login. Browser POST actions require same Origin plus session-bound CSRF. Consent requires the provider's single-use, browser-bound handle as well. Client-controlled strings are escaped, framing is forbidden, CSP remains restrictive.
- Existing fetch routes bypass the MCP wrapper; scheduled/queue handlers and workflow classes remain intact.

## Verification

`npm test` includes real OAuth provider PKCE code exchange, discovery, MCP initialization/list/call, refresh, replay rejection, audience validation, CIMD metadata, consent security, current-user permissions, revocation, read filtering and write denial. Network publishing calls are mocked and asserted absent. ChatGPT web account connection must still be completed by the user.

## Import a ChatGPT image and topic (v1.4)

**No OPENAI_API_KEY is needed.** Generate the image with ChatGPT's native image capability, then call `psychology_prepare_topic_image_import` with the topic draft only. Factory opens a **选择图片并入库** card. Opening it does not create an operation or a topic.

In ChatGPT → Local Factory connection, refresh tools and start a new conversation if the new tool is missing. Reconnect only if a write call asks for `factory.topics.write`; authorize **允许读取与图片入库**. Existing write grants cover this narrower create operation. Read-only grants stay read-only. No arbitrary edits/deletes/publication are added.

Example prompt for the failed import: “沿用刚才的题目、A/B/C/D、揭晓评论和 requestId，调用 psychology_prepare_topic_image_import 打开选图入库界面。保持停用，不调用生图 API。”

1. The model supplies `requestId`, template, title, content and choices/reveal to the prepare tool. It must not invent files, bytes or URLs.
2. A user-selected local PNG is read directly as a browser File. On confirmation, the card calls app-only `psychology_upload_topic_png` with bytes encoded for MCP JSON transport (max 8 MiB decoded). It reuses the host's OAuth tool channel; no separate multipart endpoint, upload credential, ChatGPT uploadFile or remote image download is needed. The model does not generate base64. File bytes are not persisted in widget state or tool responses.
3. ChatGPT `selectFiles()` returns file IDs, not bytes. That path obtains a temporary `getFileDownloadUrl` and calls app-only `psychology_save_selected_topic_image` without fileParams. If native generated images are absent from the library, save the PNG locally and select it. Host helper availability is feature-detected.
4. Both paths share current permissions, decoding, private storage and durable idempotency. Only `completed` plus a real topic ID displays success. URL retries retain the original file ID; byte retries use the same content hash. Preserve transport/topic/request ID after submission; changing transport or image on an existing task conflicts. A remounted card can reselect the same local file, checked by digest.

The UI is a self-contained MCP Apps HTML resource (`text/html;profile=mcp-app`), with the standard 2026-01-26 postMessage bridge and optional ChatGPT file helpers. Legacy `window.openai.callTool` is retained as a host fallback. There are no external UI assets, direct browser network requests or app-side credentials.

`psychology_import_topic_image` remains for clients whose file parameter conversion works. It declares the complete four-field file schema and `_meta["openai/fileParams"]: ["image"]`. If the client alternates between “expected object, received string” and “is not of type string”, stop retrying alternate representations and use the picker. Do not claim this error is fixed in ChatGPT itself. The old `psychology_generate_image_and_import_topic` is removed from MCP discovery/dispatch; accepted historical generation jobs remain intact.

Factory receives or downloads, stores and imports the supplied PNG; neither path invokes a generation API. Real Chrome tests exercise actual local File contents and the OAuth/MCP test fixture; the host tool bridge and library helpers are simulated. They do not prove that every ChatGPT client can pass a newly generated image automatically.

Input:
- `requestId`: fresh UUID for a new authorized import; all retries retain it.
- `image`: the actual host-provided file object. Uses the controlled URL fallback described below, including individually validated redirects. No caller cookies or bearer credentials are forwarded.
- `template`: `psychology-target-2` (single-image quiz), or `psychology-collage` (cover attachment, default).
- `title`, `content`: required topic text. `choices`: exactly four `{copy}` objects in A/B/C/D order for single-image quizzes; omitted for collage.
- `revealComment`: optional reveal comment. `enabled`: false by default.

The URL fallback accepts HTTPS oaiusercontent.com/subdomains and the bounded compatibility pattern `^oaisdmntpr[a-z0-9]{1,14}\.blob\.core\.windows\.net$`. This covers westus/westus3/eastus2 without enumerating regions and rejects other Blob tenants, nested/lookalike domains, credentials, fragments and nonstandard ports. **The prefix does not prove OpenAI ownership.** It is an explicitly requested compatibility rule. Every redirect repeats checks; URLs/signatures are not persisted or logged.

Operation errors return `ok:false`, `status:failed`, `errorCode`, `message` and hostname-only `host` when relevant, plus the code in text. An outer client INVALID_ARGUMENT still cannot identify the server error alone. A failed call is distinct from the persisted operation's retriable status.

This version accepts complete PNG files up to 8 MiB and 4096 pixels per side. Format is checked from bytes: signature/dimensions, CRC, static PNG structure, DEFLATE decoding, filters, Adam7 passes and palette indices. Scanlines use two bounded row buffers; excess/incomplete decompressed data fails. Animated PNG is rejected. MIME/name are not trusted. Download is bounded to 30 seconds and a bounded redirect count. Other formats/hosts return an actionable error rather than following arbitrary URLs. Four-image quizzes are not supported by this one-image tool. Collage covers are attached to the topic; the collage renderer itself is unchanged.

`psychology_topic_image_operation_get` returns owner-scoped status, including historical generation operations. Only **completed** means imported. Completed imports return the real topic ID/revision/enabled, private asset URL/hash/dimensions and `imageSource: chatgpt-file` or `client-png`; no guessed generation model is assigned.

Idempotency binds owner/requestId, topic content and file_id, excluding expiring download URLs and cosmetic MIME/name. Refreshing the same file's URL is safe; a different file ID or topic under the same request ID returns REQUEST_ID_CONFLICT. Signed URLs are never stored. A SQL claim serializes concurrent retries; immutable R2 bytes are the recovery checkpoint. A failed download stores no asset/topic. R2/D1/import failures recover on retry using the original request ID without downloading already-stored bytes. Interrupted requests can resume after a 180-second lease. Import errors do not trigger new image generation.

Official file input and UI contract: https://developers.openai.com/plugins/reference#file-apis

MCP Apps bridge specification: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx

### Historical v1.1 generation jobs

The old workflow class and internal generator remain only to avoid interrupting already accepted work. They are not exposed as callable MCP creation tools. Existing jobs use their old immutable inputs and the existing owner-scoped status tool. The new file-import path needs neither the image workflow binding nor an OpenAI key.

## ChatGPT cross-origin connection handling

The protocol endpoints (`/mcp`, registration/token, OAuth discovery) accept the exact browser Origin `https://chatgpt.com` and bounded CORS preflights. OAuth authorization landing GET also accepts that origin. Cross-origin MCP calls still require bearer OAuth tokens; no cookie credentials are enabled in CORS. Authorization approval and connection-revocation POSTs remain strictly Factory same-origin with session CSRF and consent-handle checks. Other origins (including null/lookalikes) are rejected. This fixes the blanket same-origin check that rejected legitimate ChatGPT connection requests with “不允许跨站请求”。


Authorization HTML uses `Referrer-Policy: strict-origin`. Do not change these native POST form pages to `no-referrer`: Chromium then sends Origin:null even on same-origin submissions, and correct CSRF/origin validation rejects approve/deny/revoke. strict-origin sends only the site origin as Referer, never OAuth query/state. Null Origin remains rejected. A real headless Chromium regression contrasts both policies and verifies the actual form header.
