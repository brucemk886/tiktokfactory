# Project unified API

The factory project has one active `fac_api_` key. Administrators create, rotate or revoke it at `/factory-api`. The plaintext appears once and is never persisted; D1 stores its SHA-256 hash. The key uses its creating administrator's current module/account permissions. There are no per-module keys or separate execution grants in this API. Existing narrow legacy integration keys retain their original behavior.

## Calling

- Endpoint: `https://factory.tiktokaitool.com/api/v1/factory`
- Authentication: `Authorization: Bearer <PROJECT_API_KEY>`
- `GET`: machine-readable catalog with examples. Optional `module` and `action` filters.
- `POST`: `{ "module": "psychology", "action": "topics.list", "params": { "query": { "template": "all", "page": 1 } } }`
- Modules: `psychology`, `photo-factory`.
- `params` holds named path IDs (for example `id`, `variantId`), `query`, and `body`. No arbitrary URLs, methods or headers can be forwarded. JSON requests are bounded to 128 KiB.
- Every mutation requires an envelope `requestId` UUID. The gateway injects this into existing business actions that also require it. Conflicting inner/outer IDs fail.
- Results retain the business API JSON and HTTP status. Imported item arrays can contain failures within HTTP 200; check every `results[].ok/error`.
- Use listing operations to discover actual IDs, current revisions, styles, directions and strategy values. Examples with placeholder IDs are not executable unchanged.

## Scope

Psychology includes template topic import/edit, original and rewrite reads/edits, model rewrites and imports, peer imports, styles and report views, reports, publish creation/retry, TikTok One brand/project/preparation reads and automatic-operation controls. Publish creation reuses exact-project membership and existing official scheduling validation. It accepts the optional `tiktokOne` brand connection/account/campaign object.

Photo factory includes owned directions and config, original/rewrite library, model rewrites, scoped account directory, automatic-operation drafts/start/pause/end and reports. Direction/account ownership and overlap protection remain in the existing services.

Psychology automatic-operation creation is paused; use the returned revision and `autopilot.update` with `status:active` to start. Photo factory creation is a draft; use its ID with `autopilot.update` to start. This preserves the existing business workflow, with the same project key for both steps. Activation/publication creates real work; no separate execution credential is needed.

## Retry semantics

Mutation claims are durable and keyed by administrator ID plus request UUID. Module/action/canonical input hash must match. A completed retry replays the original JSON/status with `X-Idempotent-Replay:true`; no business code reruns. Read operations are fresh delegated queries, not mutation receipts.

HTTP 409 `REQUEST_IN_PROGRESS` and HTTP 503 `RESULT_UNKNOWN` must never cause a new UUID retry. Query the original module with:

```json
{"module":"photo-factory","action":"requests.get","params":{"id":"ORIGINAL_REQUEST_UUID"}}
```

The response contains state, original action, timestamps and any saved result. A crash or result-save failure deliberately leaves the claim processing, because a side effect might already exist. Inspect business records and resolve manually; there is no expiring execution lease or automatic replay after uncertainty. Receipts currently have no automatic TTL. Reusing the same UUID after an explicitly completed validation failure returns that failure; corrected input needs a new UUID.

## UI

The sidebar's **统一 API** page provides key metadata, create/rotate/revoke controls, copyable AI instructions and a downloadable catalog. Copying instructions does not include the secret. The key remains in memory only until cleared or the page is left. The page loads metadata/catalog once; switching modules is local.
