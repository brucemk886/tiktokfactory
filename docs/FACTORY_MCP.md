# ChatGPT / Factory MCP

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
- 19 original read tools: psychology topics list/get; copies list/get; rewrites list/get; publish options/accounts/list; effects get; operations get; styles list; autopilot list/get. Photo factory directions/copies/accounts/autopilot list and reports get.
- List endpoints retain business pagination. Explicit pageSize is capped at 50 (default 20). Small configuration/account directories retain existing directory semantics; there is no automatic traversal of all pages.
- Two additional tools provide scoped image generation/import and operation status (21 total for an admin with all modules). No publishing, deletes or autopilot activation tools. The internal query adapter still rejects writes.
- Query tool arguments are allowlisted; token/password/API-key fields are stripped recursively from structured responses. Tool output is business data, not instructions.
- `/factory-mcp` needs factory session login. Browser POST actions require same Origin plus session-bound CSRF. Consent requires the provider's single-use, browser-bound handle as well. Client-controlled strings are escaped, framing is forbidden, CSP remains restrictive.
- Existing fetch routes bypass the MCP wrapper; scheduled/queue handlers and workflow classes remain intact.

## Verification

`npm test` includes real OAuth provider PKCE code exchange, discovery, MCP initialization/list/call, refresh, replay rejection, audience validation, CIMD metadata, consent security, current-user permissions, revocation, read filtering and write denial. Network publishing calls are mocked and asserted absent. ChatGPT web account connection must still be completed by the user.

## Generate an image and import a topic (v1.1)

Configure **Cloudflare → Workers & Pages → tiktok-factory → Settings → Variables and Secrets → Add → Secret**, name `OPENAI_API_KEY`, value your OpenAI API key, then save/deploy the secret. This is an API credential with image-model access; do not paste it into ChatGPT or source control. `/factory-mcp` displays only configured/not configured.

Refresh the connection's tools in ChatGPT and reconnect when asked for `factory.topics.write`. Consent must say **允许读取与生图入库**. Existing `factory.read` grants remain read-only. Missing scope returns the MCP insufficient-scope challenge; the model cannot grant itself access. If the client does not offer step-up, recreate the connection with the new scope. This scope only covers this specific create operation, not arbitrary topic updates or publishing.

`psychology_generate_image_and_import_topic` accepts:

```json
{
  "requestId": "c8d6b9a9-a971-48bf-a4fb-c67abc6de067",
  "template": "psychology-collage",
  "title": "为什么越亲近越容易焦虑",
  "content": "一段完整的心理学主题正文",
  "imagePrompt": "Quiet editorial illustration about connection and personal space, no text",
  "imageModel": "gpt-image-2",
  "imageSize": "1152x2048",
  "enabled": false
}
```

Generate a fresh UUID for each new user-authorized operation; reuse it for all retries of that operation. The tool enqueues a durable Cloudflare Workflow and returns promptly. Query `psychology_topic_image_operation_get` with the original requestId. **Only `completed` means imported.** Closing ChatGPT does not cancel accepted work. Completed output includes topic ID/revision/enabled, asset ID/private URL/dimensions/hash/model and stable importRequestId.

- Official `POST https://api.openai.com/v1/images/generations`, fixed `gpt-image-2`, `n=1`, medium quality, PNG. Supported dimensions: 1024x1024, 1024x1536, 1536x1024, 1152x2048 (9:16). Maximum stored image 8 MiB.
- `psychology-collage`: saves an attached topic cover visible in the topic bank; the existing collage video renderer is unchanged and does not automatically use this cover.
- `psychology-target-2`: provide exactly four `choices:[{"copy":"A text"},...]`, A/B/C/D by order. The asset's R2 key becomes the actual single-image quiz image. `revealComment` is optional. Existing single-image rendering can use it.
- Four-image `psychology` is not accepted by this single-image tool; no generated cover is duplicated into four choices.
- New topic defaults to disabled. Explicit `enabled:true` makes it eligible for later normal bank selection; this tool never directly publishes.
- Images use existing private `psychology-topics/UUID.png` R2 objects. `asset.url` is a logged-in Factory preview, not a public CDN URL or a ChatGPT image attachment. Inspect it in the topic bank.

### Durable states and recovery

`pending → generating → image_ready → importing → completed`; definitive rejections are `failed`, ambiguous provider/storage outcomes are `unknown`.

A SQL pending→generating claim allows at most one provider attempt per owner/requestId even if Workflows replays a step. Paid generation has zero automatic retries. A fixed workflow ID makes dispatch retries safe. Same UUID/different normalized input returns REQUEST_ID_CONFLICT. Current admin/topic-bank permission is checked before generation and before import. Status is scoped to the current owner.

After R2 save, deterministic object key plus operation/hash metadata recover an image even if the D1 asset write failed. Downstream import reuses the actual `writeIntegrationTopics` handler and its topic fingerprint (including asset IDs); it checks `accepted`, per-item `created/skipped`, and the saved topic/asset link. It does not route through the external HTTP dispatcher: importRequestId is an audit correlation ID, not a `requests.get` receipt. Recovery uses the MCP operation-status tool and the same generation requestId.

- `OPENAI_NOT_CONFIGURED`: configure the secret; no operation/payment has started.
- `OPENAI_HTTP_4xx`: definitive rejection recorded; do not automatically create replacement requests.
- `unknown`: do not change UUID or regenerate automatically. Resubmitting the **same input and UUID** only checks R2 and imports durable bytes if available. If no bytes were saved, operator/provider investigation is required; a new paid attempt needs the user's decision.
- `IMPORT_PENDING`: image saved but import retries exhausted. Resubmit the same input/UUID to retry import without calling OpenAI, even if its key has since been removed.

Tests mock all providers. Initial rollout has no OpenAI key, so paid generation needs a real one-image check after the user configures it.
