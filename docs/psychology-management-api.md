# Psychology management API

Four psychology modules expose scoped management APIs under `/api/integrations/psychology/manage`. The deployed, copyable contract and request examples are maintained in [the public guide](../public/psychology-management-api-guide.txt). Each corresponding hosted page has an admin-only **API 接口** button.

- `effects`, `operations`: GET existing report data with the same current module scope and calculation rules. POST /views, GET /views[/id], PATCH /views/id maintain owner-scoped query presets; raw metrics are never editable here.
- `autopilot`: paginated GET and single-plan detail; POST creates a paused plan with a deterministic request ID. Revision-guarded PATCH supports state, strategy, ending time, future schedule and member state. There is no external /run. Explicit activation lets the existing scheduler create real jobs.
- `styles`: GET merged built-in / owner overrides / custom registry; POST clones an existing style, PATCH changes validated colors, layout, name or enabled state. New styles default disabled. All future owner photo tasks draw from enabled styles and freeze the entire definition; old tasks fall back to the historical static definitions.

## Account and content pools

Migration 0068 adds current/pending strategy overlays and cycle boundaries without changing legacy strategy constraints. Revision-guarded PATCH /autopilot/id/strategy with strategy=pools and days=7 schedules a new cycle after the last reserved operating-zone date. Existing jobs and paused memberships are preserved. Migration 0069 freezes each allocated account/content pool, copy hash, style revision, cycle and reason.

Operations panel=pools supports summary/accounts/content/matrix and pool filters. Effects provides publication, playback, interaction and profile-traffic data. The report separates latest cumulative observations from posts at least 72 hours old, frozen actual allocations from retrospective classifications, and null from zero. No exact historical 72-hour snapshots exist.

During startup, stable accounts complete five-account exact copy/style baselines. Low accounts wait when qualified content is unavailable; diagnostics review six mature posts across three sources before more allocations. Confirmed failures release sample occupancy; unknown remote results and retries keep it. Scope is rechecked at each allocation.

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

Migration 0072 adds explicit `timeZone` (America/Los_Angeles or Asia/Shanghai) to plan creation and schedule changes. Creation defaults to legacy Shanghai; schedule omission preserves the current/pending zone. Local calendar boundaries follow DST. Project-managed schedules must retain the project zone and three rounds and cannot take effect before the project cycle starts.


## 承接引流日报（登录会话读取）

运营报表的「承接引流」tab 使用 GET /api/psychology-receiving-report。需要当前有效的 psychology-ops-report 模块权限；发布账号和承接账号均须在当前心理学项目授权范围内。此会话接口不改变现有外部 operations action 的契约。

参数：period=today（默认）/yesterday/7d/30d/range；自定义搭配 from、to（YYYY-MM-DD，最多90天）；receiver 为可选的承接 connectionId；page 为图文明细页，每页20条。返回 summary、daily、receivers（含发布账号汇总）、details、pagination、独立站覆盖及 UTC 主页日报完整性。

图文按北京时间实际发布日统计最新累计播放，不是当天新增曝光；主页访问使用同名日期 UTC 日报。短链接点击是有效访问数，不等于 TikTok 官方链接点击或独立访客；进站和测试按点击关联去重，跨日结果仍归点击日。不会将承接账号整体访问直接归因于 @ 图文。已发布素材清理不删除已保存的轻量承接关系。
