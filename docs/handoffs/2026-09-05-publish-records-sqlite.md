# 2026-09-05 官方发布记录 SQLite 与可靠增量同步

## Goal

把本地官方 API 发布记录的运行时读写迁到 SQLite，去掉每条记录重复携带的账号历史快照；把工人「先截 800 再筛选」改成可恢复、分页、持久化确认的增量同步。GeeLark 不迁移。生产不自动切换。

## Decisions

- 发布表做进现有 `workDir/official-tiktok-history/official-history.sqlite`，复用 `account_daily_snapshots` / `video_daily_snapshots`，同一事务写记录、快照、outbox。
- 默认仍走 `publish-records.json`。只有 `official-publish-store.json` 的 `enabled: true` 或环境变量 `OFFICIAL_PUBLISH_STORE=sqlite` 才切 SQLite。本次没有 enable、没有重启、没有部署。
- `mergeOfficialPublishRecords` 默认仍 slice(3000) 给展示；持久化/迁移/云端 v2 传入 `{ limit: 0 }`。
- 游标用 outbox 单调 `seq`，不用 `updatedAt`。普通 `{ok:true}` 不能确认 v2。
- 复制数据库到另一台机器必须换 `source_store_id` 并清空 ACK。
- 别人已有的未提交改动全部保留，未改 `CURRENT_STATE.md`（生产状态没变）。

## Files changed

新增：

- `scripts/official-history-db.js`
- `scripts/publish-record-store.js`
- `scripts/publish-record-runtime.js`
- `scripts/publish-record-migrate.js`
- `scripts/publish-record-sync.js`
- `factory-cloud/src/publish-records-sync-v2.js`
- `factory-cloud/migrations/0020_publish_source_revisions.sql`
- `scripts/publish-record-store.test.js`
- `scripts/publish-record-migrate.test.js`
- `scripts/publish-record-sync.test.js`
- `scripts/publish-record-store.scale.test.js`
- `factory-cloud/src/publish-records-sync-v2.test.js`
- `docs/publish-records-sqlite-cutover.md`
- 本交接

适配：

- `scripts/official-analytics-archive.js`（共用连接，不因此启动归档任务）
- `scripts/official-publish-records.js`
- `scripts/official-publish-result-sync.js`
- `scripts/auto-task-manager.js`
- `scripts/server.js`
- `scripts/factory-cloud-worker.js`
- `factory-cloud/src/jobs.js`
- `factory-cloud/src/publish-records-store.js`
- `docs/PIPELINE.md`

未改：`publish-service.js`、Minecraft、素材策略、渲染、排期、TikTok/GeeLark 发布动作、账号授权、页面风格、`CURRENT_STATE.md`、他人未提交文件。

## Tests performed

本机 Node v22.16.0，Windows 10 19045 x64，隔离临时目录，未打真实发布 API，未改生产库。

- 新增存储/迁移/同步行为测试 + 官方记录/结果同步/归档/工人/auto-task 相关测试通过。
- `factory-cloud` `npm test`：182 通过。
- 规模基准（隔离目录）：90000 条官方合成记录导入 12.5s；补丁 p50/p95 = 1ms/1ms；200 条分页 p50/p95 = 6ms/10ms；峰值 RSS 约 377MB（含导入前 JSON）；DB 约 151MB（含初始 outbox）；同步 451 页；1000 账号 × 30 天账号快照 = 30000 行。EXPLAIN QUERY PLAN 全部走对应索引。

## Unfinished work

生产切换未做：未 backup 真库、未 import 真 `publish-records.json`、未 enable、未部署工厂云、未重启工人、未删旧文件。内置浏览器未验证页面。90000 条基准的 DB 体积含全量 outbox，比「仅记录+去重快照」大。

## Recommended next step

按 `docs/publish-records-sqlite-cutover.md`：先部署工厂云（迁移 0020），再在无渲染/发布窗口 dry-run → backup → import → verify → enable → 重启工人。确认多页 ACK 后再考虑删 JSON 官方部分；GeeLark 历史继续留在原文件。
