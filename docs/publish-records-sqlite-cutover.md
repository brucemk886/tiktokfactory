# 官方发布记录 SQLite 切换（尚未执行）

代码和离线测试已完成。**生产仍在读写真 `work/publish-records.json`。** 不要把「测试通过」当成已经切库。

默认完成定义：

| 状态 | 现在 |
|---|---|
| 代码完成 | 是 |
| 离线测试通过 | 是 |
| 迁移工具就绪 | 是 |
| 生产导入 | 否 |
| 生产 enable | 否 |
| 工厂云部署 v2 接口 | 否 |
| 工人重启切 SQLite | 否 |
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

## 安全切换（人工执行，需停发布窗口）

先部署工厂云（含迁移 `0020_publish_source_revisions.sql`），再开本机开关。旧工人打到只支持旧协议的云端时，v2 不会把 `{ok:true}` 当成确认。

在 `D:/cursor/localfactory`：

```text
node scripts/publish-record-migrate.js dry-run --work-dir D:/localfactory-data/work
node scripts/publish-record-migrate.js backup-sqlite --work-dir D:/localfactory-data/work
copy D:\localfactory-data\work\publish-records.json D:\localfactory-data\work\publish-records.json.bak
node scripts/publish-record-migrate.js import --work-dir D:/localfactory-data/work
node scripts/publish-record-migrate.js verify --work-dir D:/localfactory-data/work
```

校验无损、无未处理异常、原 JSON hash 未变之后：

```text
node scripts/publish-record-migrate.js enable --work-dir D:/localfactory-data/work
```

然后等当前渲染/发布结束，再重启本机工人。不要在有 `official-publish` 运行时 enable。

## 回滚

若切换后已有新官方写入，不要只恢复最初 JSON。

```text
node scripts/publish-record-migrate.js export-rollback --work-dir D:/localfactory-data/work --out D:/localfactory-data/work/publish-records.rollback.json
```

导出文件 = SQLite 官方记录 + 当时 JSON 里的 GeeLark。关掉 `official-publish-store.json` 的 `enabled` 后，用该文件替换运行中的 `publish-records.json`。云端已接受的记录按幂等保留，不要删 D1 行。
