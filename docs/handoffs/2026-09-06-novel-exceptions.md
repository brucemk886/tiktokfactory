# 2026-09-06 小说推文异常中心（首版）

## Goal

工厂做成异常投影 + 人工工作流。发布终态仍归中台，本机只上报。异常中心不能变成第二套发布队列，也不能封装云端 `retry-publish` / `resume`。

## Decisions

- 唯一状态库：工厂 D1 `factory_novel_exceptions` + `factory_novel_exception_actions` + `factory_novel_exception_meta`。迁移是 `0021`，不是 `0020`。
- 本机队列：`work/novel-exceptions.sqlite`，不写官方发布 outbox，也不和发布 WAL 抢锁。
- 首版种类：`production_failed`、`awaiting_review`、`upload_handoff_failed`、`worker_heartbeat_timeout`、`official_publish_failed`、`publish_needs_review`、`result_sync_failed`、`account_auth_failed`、`other_production`。
- 推迟：`stuck_no_progress`（先要遥测）、`content_mapping_missing`（两套 30 分钟匹配不一致）、中台 attention API、5 分钟 cron、任务遥测。
- `needs_review` 看 `officialRemoteStatus` 或回执 `task.status`，不要等工厂 `status === 'needs_review'`。
- 授权失败只认 `errorCode`：`unauthorized`、`auth_failed`、`token_expired`、`scope_missing`、`video.publish`。不猜中文。
- 旧错误没有 `errorCode`：归 `other_production`。
- 工人心跳：超过 10 分钟没有成功 `sync` 才报「心跳超时」，不写「机器已死」。`poll` 不更新 `lastSeenAt`。
- 第 81 条失败：本机在 compact 前按产物 / 官方记录一行上报。不放宽 `VIDEO_LIST_CAP=80`。云端对账扫任务 JSON 时承认看不到第 81 条，不能据此标恢复。
- 不扫 `auto-tasks` 列表（默认 200 / 上限 1000）。第 201 / 1001 条任务不依赖这份截断列表。
- 对账挂在现有每日 cron 多一步。`wrangler.jsonc` 仍是 `0 0` / `0 16`。
- 导航：云端 `withOpsReportModules` 只给 admin 插模块；catalog `["admin"]`。本地 `migrateStore` bump 到 29。API 独立鉴权：`role===admin` 且 `sidebarModules` 含 `novel-exceptions`。
- 本地 `/novel-exceptions` 走 `shouldRedirectLocalPageToFactory` → `https://factory.tiktokaitool.com/novel-exceptions`。
- 任务页徽标是插入脚本，不改 `public/tasks.js` / `tasks.css`。
- 发布类按钮只保留「前往中台」。生成/上传失败只给任务列表 + 复制 ID。
- 忽略 / 人工结案不改业务任务状态，也不发视频。忽略到期后，只有该实体仍失败的新证据才回到待处理。
- 一次列表分页失败，不能把没扫到的异常标 recovered。来源不可达保持 `unknown`。
- 账号授权按账号聚合（fingerprint 带 `connectionId`）。

## Source status map

| 源 | 读什么 | 异常 |
|---|---|---|
| 本机任务 | `status`、`publishResults[]`、`generationWarnings`、`publishRecordError` | 失败成片、待确认、交接失败 |
| 本机官方记录 | `status` + `officialRemoteStatus` | 发布失败 / `needs_review` / 同步宽限 |
| 云 `factory_jobs` 终态 | `status` / `error` | 混剪失败；`done` 按 `production_failed\|job\|{id}` 恢复 |
| 中台回执 / v2 记录 | payload `task.status`、记录 `officialRemoteStatus` | 发布失败、待核查 |
| KV `factory-workers` | `lastSeenAt` + 该工人 queued/running 小说任务数 | 心跳超时 |

阈值：工人 10 分钟；发布结果同步宽限 7 天；已解决保留 90 天；忽略可选 1h / 24h / 本次事件。

## Files

新增：`scripts/novel-exception-rules.js`、`scripts/novel-exception-reporter.js`、`factory-cloud/src/novel-exceptions.js`、`factory-cloud/src/novel-exceptions-store.js`、`factory-cloud/migrations/0021_novel_exceptions.sql`、`public/novel-exceptions.html|js|css`、`public/novel-exception-badge.js`、对应测试、本交接。

接线：`factory-cloud/src/index.js`、`jobs.js`、`publish-records-store.js`、`pages.js`、`sidebar.js`、`auth.js`、`scripts/local-auth.js`、`scripts/sidebar-modules.js`、`scripts/auto-task-manager.js`、`scripts/factory-cloud-worker.js`、`scripts/publish-record-runtime.js`、`public/tasks.html`（只加一行 script）。

## Tests

必须留下：同一 event 重放 10 次仍一项、新 attempt 重开、取消不是失败、未来排期不报同步滞后、无 errorCode 归 other、第 81 条产物 / 官方记录、忽略不改业务状态、`needs_review` 绝不自动重发、来源不可达保持 unknown、不扫 auto-tasks、不放宽 80 条、无 5 分钟 cron。

90000 任务 / 10000 异常的 p50/p95 不卡首版合并。

## Dry-run

开发 + 离线验证。不自动部署，不重启在跑的任务，不打真实发布 API。上线前先看异常分布再 enable 回填（工人启动写 `work/novel-exception-backfill.json` 标记，只回填当前未解决官方小说任务）。

## Unfinished

生产未 deploy，D1 `0021` 未打。疑似无进展、内容关联、中台 attention API、任务遥测仍推迟。别人未提交的 `public/tasks.js|css` 未覆盖。
