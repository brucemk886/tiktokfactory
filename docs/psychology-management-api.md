# Psychology management API

Four psychology modules expose scoped management APIs under `/api/integrations/psychology/manage`. The deployed, copyable contract and request examples are maintained in [the public guide](../public/psychology-management-api-guide.txt). Each corresponding hosted page has an admin-only **API 接口** button.

- `effects`, `operations`: GET existing report data with the same current module scope and calculation rules. POST /views, GET /views[/id], PATCH /views/id maintain owner-scoped query presets; raw metrics are never editable here.
- `autopilot`: paginated GET and single-plan detail; POST creates a paused plan with a deterministic request ID. Revision-guarded PATCH supports state, strategy, ending time, future schedule and member state. There is no external /run. Explicit activation lets the existing scheduler create real jobs.
- `styles`: GET merged built-in / owner overrides / custom registry; POST clones an existing style, PATCH changes validated colors, layout, name or enabled state. New styles default disabled. All future owner photo tasks draw from enabled styles and freeze the entire definition; old tasks fall back to the historical static definitions.

## Authorization and ownership
The `psy_manage_` key is separate from import keys. It is stored only as a SHA-256 hash and prefix in `psychology_management_keys`; full keys are returned once at creation. Scopes are module:read / module:write. Each request reloads the active administrator and effective sidebar permissions; publishing writes additionally require psychology-publish. Existing admin semantics permit all psychology groups, not arbitrary projects. Historical plans containing accounts outside the current psychology project scope are hidden/rejected externally to avoid leaking their stored logs/aggregates.

Internal authenticated /api/psychology-management/api-key supports GET metadata, POST create/rotate, DELETE revoke; mutations reject cross-origin requests. /styles is the internal GET gallery adapter. Operators cannot manage keys.

Migration 0063 adds key, report-preset and style tables and autopilot request fingerprints. Presets and styles use integer revisions; plans/accounts use monotonic updated_at revisions. Creation request IDs give deterministic IDs and content fingerprints. Stale writes return 409. Single-statement guarded updates enforce revisions and at least one enabled style. JSON bodies are bounded to 128 KiB, unknown fields rejected, and no arbitrary internal route proxy exists.

## Validation
- New management endpoint tests cover bearer auth through the Worker entry, scope/revocation/current privileges, both reports, preset ownership and concurrency, style lifecycle/limits, paused creation, plan revisions and current group scope.
- Browser test serves only local files and simulated APIs, checks all four page entries, read-only defaults, scope selection, guide loading, secret cleanup and real gallery canvases.
- Photo worker test renders a custom frozen style with the real local browser and mocked upload/publish endpoints.
- No test calls real publishing APIs.

## Scope limits
Query presets currently have an API listing rather than a separate page editor. Style layouts are selected from the existing 20 supported layouts; external HTML/CSS/code is not accepted. Definition changes affect only future work. A custom style is visible to its owner on 图文样式; fixed-selection dropdowns on older open publication forms still list built-ins, while random generation uses the current enabled registry.
