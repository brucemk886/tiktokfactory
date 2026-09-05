# 官方发布记录 SQLite 切换

2026-09-06 已在生产执行。工厂云已部署 v2 接口和迁移 `0020`。本机工人 `windows-local` 已 enable 并重启，官方记录走 SQLite，GeeLark 仍在原 JSON。

| 状态 | 现在 |
|---|---|
| 代码完成 | 是 |
| 离线测试通过 | 是 |
| 迁移工具就绪 | 是 |
| 生产导入 | 是（488 官方，0 异常） |
| 生产 enable | 是（`work/official-publish-store.json`） |
| 工厂云部署 v2 接口 | 是（`abddcc08-fe36-494b-8fc5-6909387a44c7`，D1 `0020`） |
| 工人重启切 SQLite | 是（pid 以 watchdog 为准） |
| 首次 v2 ACK | 是（acked_seq = 488） |
| 旧 JSON 删除 | 否，也不要删 |

## 调用方

### 已适配的官方读写（开关打开后走 SQLite）

- `persistOfficialPublishRecords`（`auto-task-manager.js`、工人发布完成）
- `scripts/server.js` 的 `readPublishRecords` / `writePublishRecords` / `appendPublishRecords`（官方部分）
- `getOfficialPublishRecordsSummary`
- `createOfficialPublishResultSync`（补丁写入 + 用快照表判断是否到期）
- 成片清理 `listRecordsForOutputCleanup`
- 素材使用率 / 小说效果等通过 `readAllPublishRecords` 读官方最新播放
- 工人 `syncOfficialPublishRecordsIfEnabled` → `POST /api/worker/publish-records/sync`

未开开关时，以上官方路径仍只写 JSON，行为与原来一致（但不再先截 800 条再筛选）。

### 范围外（GeeLark，不要改）

- `scripts/publish-service.js` 继续读写同一份 JSON
- `/api/publish-records` GeeLark 发布记录页
- GeeLark 重试、GeeLark 分析匹配

切换后 JSON 里的 GeeLark 历史必须原样保留；官方新记录不得再写回该文件。

## 已执行的生产步骤（2026-09-06）

工作区先只提交本任务后 push `main`，工厂云 `npm run deploy`。本机 `workDir=D:/localfactory-data/work`：

```text
node scripts/publish-record-migrate.js dry-run --work-dir D:/localfactory-data/work
node scripts/publish-record-migrate.js backup-sqlite --work-dir D:/localfactory-data/work
copy D:\localfactory-data\work\publish-records.json D:\localfactory-data\work\publish-records.json.bak
node scripts/publish-record-migrate.js import --work-dir D:/localfactory-data/work
node scripts/publish-record-migrate.js verify --work-dir D:/localfactory-data/work
node scripts/publish-record-migrate.js enable --work-dir D:/localfactory-data/work
```

dry-run：3762 条里 488 官方 / 3274 GeeLark，无重复、无未知、无缺 id。import 无损，源 JSON hash 未变。然后停 `server.js`，守护 `LocalFactoryWatchdog` 拉起新进程。

`backup-sqlite` 必须把 `--work-dir` 传进函数；CLI 若把整个 options 对象当路径，会写到错误目录。`backupSqliteConsistent` 同时接受字符串和 `{ workDir, outputPath }`。

备份文件：

- `D:/localfactory-data/work/publish-records.json.bak`
- `D:/localfactory-data/work/official-tiktok-history/official-history.backup.1788625219181.sqlite`

## 回滚

若切换后已有新官方写入，不要只恢复最初 JSON。

```text
node scripts/publish-record-migrate.js export-rollback --work-dir D:/localfactory-data/work --out D:/localfactory-data/work/publish-records.rollback.json
```

导出文件 = SQLite 官方记录 + 当时 JSON 里的 GeeLark。关掉 `official-publish-store.json` 的 `enabled` 后，用该文件替换运行中的 `publish-records.json`。云端已接受的记录按幂等保留，不要删 D1 行。
