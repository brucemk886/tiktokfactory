# 发布链路总览（2026-09-03）

本文描述当前线上真正在跑的一条链路：本机工人渲染 → 工厂云调度 → 中台 Signal Desk 调 TikTok API 发布 → 结果回执回到工厂。三段代码分别在：

| 段 | 位置 | 运行环境 | 域名 |
|---|---|---|---|
| 本机工人 | `scripts/server.js` + `scripts/factory-cloud-worker.js`（本仓库） | Windows 本机 Node，端口 3010，守护 `scripts/factory-watchdog.js` | — |
| 工厂云 | `factory-cloud/`（本仓库） | Cloudflare Worker，D1 `factory-prod`，R2 `factory-archive` | `factory.tiktokaitool.com` |
| 中台 Signal Desk | `D:\cursor\tiktokaitool` | Cloudflare Worker，D1 `signal-desk-prod`，R2，Queues，Durable Object | `tiktokaitool.com` |

发布规则：工厂云用 `factory-cloud` 目录的 `npm run deploy`；中台用 `tiktok-analytics-cloud` 的 `npm run cloudflare:deploy`。两者都会先核对 GitHub `main`。

---

## 1. 一张图

```
 本机工人 (windows-local)                 工厂云 factory.tiktokaitool.com                中台 tiktokaitool.com                 TikTok
 ─────────────────────                    ────────────────────────────                 ───────────────────────               ──────
 hello ───────────────────────────────▶  /api/worker/hello  重排本机中断 running
 render lane ×2  claim ───────────────▶  /api/worker/claim  LIMIT 1, 排除 official-publish
   ffmpeg/TTS 渲染成片
   complete{publishPending} ──────────▶  /api/worker/jobs/:id/complete
                                          └─ enqueue official-publish (publishOnly)
 publish lane ×1  claim ──────────────▶  /api/worker/claim  仅 official-publish
   上传成片 ──────────────────────────────────────────────────────────────────▶  POST /api/v1/publish/assets(/sign) → R2
   创建批次 ──────────────────────────────────────────────────────────────────▶  POST /api/v1/publish/batches
   本地写 publish-records.json                                                    prepare 队列 → scheduled/queued
                                                                                  每分钟 cron 派发到期 → submit 队列
                                                                                  submit：账号锁 + 全局限流 16rps ─────────▶ video/publish
                                                                                  status 队列 60/120/300s 轮询 ────────────▶ publish/status
                                                                                  published(+item_id) / failed / needs_review
                                                                                  写 hub_webhook_deliveries
 每 5 min syncInventory ──────────────▶  /api/worker/sync                          每分钟 cron 入队投递
   只传 5 min 内有变化的官方记录           merge 只 upsert 变化行 + 建 refs 索引
                                          ◀──────────────── POST /api/integrations/signal-desk/publish-events (HMAC) ◀── webhook 队列
                                          receipt → refs 找 record → 回写状态/item_id
 每日 08:30 official-publish-result-sync                                            每 5 min 补拉：只处理缺 item_id 的账号，40 个/次
   拉批次快照，7 天无终态 → needs_review                                             每日 23:00 UTC 全量同步账号+视频，资料组每周一次
```

---

## 2. 本机工人

### 2.1 进程与守护

- 入口 `scripts/server.js`，`PORT` 默认 3010；`config.json` 里 `workDir=D:/localfactory-data/work`、`outputDir=D:/localfactory-data/outputs`。
- 守护 `scripts/factory-watchdog.js`：每 10s 探活端口，进程死且端口关就拉起（最短间隔 5s）；状态文件 `work/factory-watchdog.json`，日志 `work/factory-watchdog.log`；单实例锁 `work/factory-watchdog.lock`。开机由计划任务 `LocalFactoryWatchdog`（ONLOGON）拉起，`node scripts/factory-watchdog.js --install` 可重注册。
- `uncaughtException` 与 `unhandledRejection` 都记 `work/server-crash.log` 后 `exit(1)`，交给守护重启（半死进程占着端口会骗过守护，所以宁可崩）。

### 2.2 与工厂云的协议（`scripts/factory-cloud-worker.js`）

配置来自 `work/factory-cloud-worker.json` 或环境变量：

| 键 | 当前值 | 说明 |
|---|---|---|
| `url` / `token` | `https://factory.tiktokaitool.com` / `WORKER_TOKEN` | 必填 |
| `workerId` | `windows-local` | 每台机器固定且互不相同；hello 只重排同 id 的中断任务，任务可在创建时指定给某台（见 2.6） |
| `assignedOnly` | 默认 false | true = 只接 `targetWorkerId`/`renderWorkerId` 等于自己的任务，不接没指定机器的；第二台机器配 true。`FACTORY_WORKER_ASSIGNED_ONLY` |
| `label` | 空 | 建任务页下拉里显示的名字，`FACTORY_WORKER_LABEL` |
| `pollMs` | 60000 | 空闲时 claim 间隔 |
| `syncMs` | 300000 | 库存同步间隔 |
| `renderConcurrency` | 默认 2（1–8） | `FACTORY_WORKER_RENDER_CONCURRENCY` |
| `publishConcurrency` | 默认 1（1–8） | `FACTORY_WORKER_PUBLISH_CONCURRENCY` |
| `renderJobTypes` | 默认空 = 除 `official-publish` 外都接 | 渲染通道白名单（数组或逗号分隔），`FACTORY_WORKER_RENDER_JOB_TYPES`；第二台机器配 `["auto-task","reddit-mix"]` 只接混剪 |

两条通道各自循环：`render` 通道 claim 除 `official-publish` 外的所有类型；`publish` 通道只 claim `official-publish`。每次 claim 最多 1 条，通道内用 `active` 集合顶到并发上限。claim 失败固定睡 5s 重试；任务失败只打日志、释放槽位。

渲染完成后 `complete` 带 `publishPending: true`，云端另起一条 `official-publish` 任务给 publish 通道，渲染和发布互不阻塞。

本机不上报 `/progress`（云端 UI 在 claim 到 complete 之间没有中间进度），也不轮询云端取消，取消只看本地任务文件。

### 2.3 库存同步 `syncInventory`

每 5 分钟 `POST /api/worker/sync`，body 里 `officialPublishRecords` 只含 `max(updatedAt, createdAt, publishedAt) >= 上次同步时间 - 60s` 的官方记录，最多 800 条；首次启动传全量。另带 `redditMixSettings`、`retentionHours: 48`，首次还会上传小说库。GeeLark 记录不上传。素材组 / 音频目录不走这条定时同步：目录变化在本机 Reddit 混剪页点「刷新并推送」。素材使用率只在各台本机 `localhost:3010/asset-usage` 查看，不再上传工厂。曾经每个北京日自动推最近 8 个目录，已删，避免半量覆盖线上清单。

### 2.4 排产与日上限（`scripts/auto-task-manager.js`）

- 日规划上限：`FACTORY_DAILY_PLANNED_LIMIT` 环境变量 > `config.autoTasks.dailyPlannedLimit` > 默认 300，上限 100000。**本机 `config.json` 已配 3000**（`config.json` 不进 git，`config.example.json` 有同样示例）。
- GeeLark 日上限：`config.geelarkSafety.dailyPublishLimit`，本机已配 3000（默认 300）。
- 调度（`planOfficialPublishJobs`）：轮询分账号，但在「当前条数最少的账号」里优先挑**没发过这条音频**的那个，同一账号只在所有账号都发过这本书时才重复；账号 k 的时间是 `scheduleAt + 本账号第几条 * interval + floor(interval * k / n)`，即同一波的 n 个账号在间隔内错开（interval=0 不错开）。`schedulePlan` 的展示仍按波次起点归并。自动发布起点至少 now+300s；磁盘剩余 <20GB 拒绝。
- 音频轮转（`scripts/audio-rotation.js`）：按音频文件夹勾选的任务，工人在 `work/audio-rotation.json` 里按「文件夹组合」记游标，每个任务从上次停下的位置接着走完整个文件夹再回头；领窗口时就推进游标，两条渲染道并跑也不撞。传了 `audioOffset`、`audioPriority`、`audioItems` 或 `audioRotation:false` 的任务不走游标。
- 推广码门禁（`reddit-mix-job.js`）：`burnNovelBadge !== false` 的任务，某条音频解析不出 `promotionCode`（小说库 → 文件夹 `novel.json` → 任务兜底）就跳过不出片，warning 写「没有推广码，已跳过」，全部没码则任务失败。勾了多个音频文件夹时任务 payload 里那份（只来自第一个文件夹）的 platform/推广码不再兜底给其它文件夹的音频，避免 A 书的码印到 B 书上。`requirePromotionCode:false` 可关。
- 模板1 素材子文件夹（`generation.assetFolders`）：素材组仍是 `assetLibraryRoot` 下的一级目录。组里按真实目录树勾选：点名称展开子夹，勾父夹等于全选其下所有夹，也可以只勾某一层。全勾或不传 = 整组。混剪按路径前缀过滤（勾 `minecraft/town` 不会抽到 `minecraft` 根下的片子）。点开头 / 下划线夹（`.meowload`、`_visual-review`）既不当素材组也不进勾选。本机 3010 可点「播放」预览（`GET /api/asset-library/file`）；云端页面读不到工人磁盘，预览会提示去本机。模板2 不走这套。
- 模板2 跑酷成片（`videoTemplate: "parkour"`，仅 admin、仅官方通道；`scripts/video-template.js` 的 `planParkourSources`）：底片直接用「自动跑酷软件」生成的整条视频，目录只读本层（`includeVideoSubfolders:false`，`_visual-review`/`_failed-review` 不会被抽到），默认 `D:\方块跑酷模拟器视频\0819`。每条成片只用一次（任务内 `usedParkourIds` + 跨任务 `asset-usage.json` 的 `usedCount`），选片按「浪费最少」：优先能覆盖音频时长的最短单条；没有单条够长、或单条裁掉的比拼接多，就把未用的短视频先长后短拼起来，最后一段挑刚好盖住剩余时长的；浪费相同优先单条。不再 `-stream_loop` 循环同一条。剩余未用素材加起来都不够长时这条音频跳过；素材全部用完时任务直接结束（`PARKOUR_EXHAUSTED`），不再空转。
- 容量校验（`validateScheduleCapacity`）：已完成任务算 `submitted` 条数，`queued`/`running` 任务算整份 `schedulePlan`，两者相加不能超日上限；`paused`/`failed`/软删任务不占位，resume 时排除自身。
- 日切统一用 `scripts/schedule-date.js` 的 `scheduleDateKey`，固定 `Asia/Shanghai`，与中台补拉一致，不再跟系统时区走。
- 本地任务队列串行一条（`source=factory-cloud` 的镜像任务跳过）。成片默认保留 48h，每 6h 清理。

### 2.5 官方发布（本机侧）

`publishThroughOfficialTikTok`：按 `officialWaveSize`（默认 10）分波，`officialUploadConcurrency`（默认 10）并行上传到中台（预签名 R2 或直传），然后 `POST /api/v1/publish/batches`。有断点（`submittedKeys/assets/batches`），中止时尽量取消已建批次。本地记录字段：`id = {taskId}:official:{videoIndex}:{connectionId}`、`remoteTaskId`（中台 task.id）、`externalRef = {fileName}:{connectionId}:{jobIndex}`、`connectionId`、`status`、`officialBatchIds`。

网络重试 `[2s, 5s]`，发布重试 `[3s, 8s, 20s]`，可重试码 408/429/502/503/504。

每日 08:30（北京）`official-publish-result-sync` 拉批次快照校对本地记录，7 天无终态标 `needs_review`。

### 2.6 多台工人

模型：**每台机器有自己的素材和音频，任务在创建时指定给哪台跑**；机器之间不需要互通，只要都连得上工厂云。搭建步骤见 `docs/WORKER-SETUP.md`。

- **机器登记**：hello 和 sync 都会往 kv `factory-workers` 写一行 `{workerId, label, hostname, assignedOnly, renderConcurrency, publishConcurrency, renderJobTypes, lastSeenAt}`；`GET /api/workers`（admin）返回列表，`lastSeenAt` 10 分钟内算在线。
- **指定机器**：`POST /api/auto-tasks` 接受 `workerId`（必须是已登记的机器），存在 `task.workerId`，渲染任务 payload 带 `targetWorkerId`；resume 沿用；「重试发布」的 `renderWorkerId` 取上次任务的 `worker_id`，没有就用 `task.workerId`。不传 = 不指定，谁先 claim 谁做。建任务页「执行机器」只在工厂云、且已登记 ≥2 台时显示；本机 3010 不显示，任务默认就是这台机器。
- **claim 亲和**：`COALESCE(NULLIF(targetWorkerId,''), NULLIF(renderWorkerId,''), '') IN ('', 本工人)`；工人带 `assignedOnly: true` 时改为 `= 本工人`，即不接没指定机器的任务。第二台机器必须配 `assignedOnly`，否则它会抢到主机素材组的任务然后报找不到素材。
- **成片只在渲染它的那台机器上**。渲染完成时云端起的 `official-publish` 任务带 `payload.renderWorkerId`（= 渲染任务的 `worker_id`），发布通道只会拿到自己渲染的；一台工人下线，它渲染完但还没发布的任务会一直排队等它回来，不会被别的机器抢走然后报「视频文件不存在」。
- **素材组 / 音频文件夹按机器合并**：本机 Reddit 混剪页「刷新并推送」才会把全量 `assetGroups` / `audioGroups` 送到 `/api/worker/sync`；`mergeWorkerCatalog` 打上 `workerId`，只替换同一机器的旧条目（以及 id 相同的未打标旧条目），不同机器的并存。`/api/asset-groups`、`/api/audio-groups` 返回带 `workerId`，建任务页选了机器就只显示那台的。同名素材组在两台机器上是两条不同记录，各自用各自的路径。工人不再每日自动推最近 8 个目录。
- **任务 payload 只带 `assetGroupId` 和音频 id/文件名**，工人在本机按素材组 id（= `assetLibraryRoot` 下的文件夹名）和音频文件名找文件；找不到就任务失败。所以任务必须指给拥有那些素材的机器——UI 的过滤只是帮你别选错，云端不校验。
- **机器之间不传任何东西**。新机器只需要工厂的 `WORKER_TOKEN`；`GET /api/worker/bootstrap`（worker token 鉴权）下发中台地址 + bridge key（`official-settings.apiKey` 或 `SIGNAL_DESK_BRIDGE_KEY`）、ElevenLabs key（`ELEVENLABS_API_KEY` 或 `psychology-settings`）、`reddit-mix-settings`；`scripts/worker-setup/bootstrap-worker.mjs` 用它加仓库里的 `config.example.json` 生成本机全部配置。`work/` 下每台各一份，谁也不拷谁的。
- 云端 `reddit-mix-settings` 由工人 sync 上传；没有本地文件的新工人不发这个字段，云端也忽略空对象，不会互相清空。新工人本地小说库为空时也不触发导入。
- 已知显示局限：`factory-worker-status` 只记最后一次推送的机器；建任务页的「排队等待中，前方 N 个」按同机器算，但没区分不指定机器的任务。素材使用率只在各台本机看，工厂云不再提供该页。
- 日规划上限（`config.autoTasks.dailyPlannedLimit`）只在本机 3010 页面建任务时校验，按每台机器自己的任务算；云端页面建的任务不经过它。两台机器都从 `config.json` 读，各配各的。

---

## 3. 工厂云

### 3.1 路由与鉴权

| 路径 | 鉴权 |
|---|---|
| `/api/worker/*` | `WORKER_TOKEN`（Bearer 或 `x-factory-worker-token`），无 session。`GET /api/worker/bootstrap` 用它下发共享密钥给新机器，所以这个 token 等同于拿到中台 bridge key 和 ElevenLabs key |
| `/api/integrations/signal-desk/publish-events` | HMAC-SHA256：`x-signal-timestamp` + `x-signal-signature: v1=…`，密钥 `official-settings.webhookSecret`，时钟偏差 ≤10min |
| `/api/integrations/signal-desk/storage`、`archive-accounts` | Bearer = 桥接密钥 |
| 其余 `/api/*` | Cookie session；仅 admin：`official-publish-records/sync`、`/webhook`、`POST private-tiktok/settings`、项目/分组的所有写操作（POST/PATCH/DELETE，读仍对所有登录用户开放） |
| 出站到中台 | `signalDesk()`：Bearer = `official-settings.apiKey` 或 `SIGNAL_DESK_BRIDGE_KEY`（线上用后者）。`GET /api/private-tiktok/settings` 返回 `apiKeySource: settings|env|none`，`GET /api/official-publish-records/webhook` 返回 `secretSource`，排障先看这两个字段 |

### 3.2 任务表 `factory_jobs`

状态 `queued → running → done | failed | cancelled`。claim：`status='queued' [AND type IN/NOT IN …] AND 目标机器 IN ('', 本工人)`（`assignedOnly` 时 `= 本工人`）`ORDER BY created_at LIMIT 1`，再 `UPDATE … WHERE status='queued'` 乐观锁。目标机器 = `COALESCE(NULLIF(json_extract(payload_json,'$.targetWorkerId'),''), NULLIF(json_extract(payload_json,'$.renderWorkerId'),''), '')`，只作用在 queued 行上，量很小。hello 把该 `worker_id` 下的 `running` 改回 `queued`（`LIMIT 200`，单工人同时在跑的不过几条）。终态 30 天后 cron 删除。

`complete` 时 `done && publishPending` 且 `publish.provider=official`、`autoPublish!==false` → 入队 `official-publish`（`publishOnly: true`），同时把 auto-task 的 `generationJobId` 指到新任务、`phase=publish-queued`。

### 3.3 auto-tasks

一行一任务表 `factory_auto_tasks`（`value_json`），`generatedVideos`/`publishResults` 各截 80。软删 30 天、终态 90 天后 prune。旧 KV `auto-tasks` 整包只在表为空时迁移一次。

### 3.4 发布记录与回执

- `factory_publish_records`：`mergeAndStorePublishRecords` 只读相关 id、跳过未变行、只 upsert 变化行。表按时间保留 90 天（`prunePublishRecords`，每晚 cron），不按条数裁剪。
- `factory_publish_record_refs`：`task:{remoteTaskId}`、`ref:{externalRef}` → record id。
- `factory_publish_receipts`：每条 webhook 一行；找不到记录（回执先于本机上传）保持 `applied_at=0`，下次 sync 合并时补上。页面上的回执统计 `publishReceiptStats` 拆成两条索引查询（`applied_at=0` 计数 + 24h 窗口），迁移 `0018` 加了 `received_at` 索引，不再扫 7 天。
- `official_accounts_latest` 的几处读取（归档列表、分组别名）统一 `LIMIT 5000`（`LATEST_ACCOUNTS_LIMIT`），一行一账号，1000 号远不到顶。
- `keepReceiptOutcome`：已有回执的记录，本机上传的过期状态不会覆盖云端结论。
- 回执 30 天后清理；refs 跟随记录一起在 90 天时删除。

### 3.5 webhook 注册（三条路都会触发）

1. 每日 cron `ensurePublishWebhook({ verify: true })`：本地看着已注册时，再 `GET /api/v1/webhooks` 核对端点仍在中台的 active 列表里；不在（被中台自动停用）就重注册。中台查不通视为仍在线，不误重注册。
2. admin `POST /api/official-publish-records/sync`（同样 verify；`?force=1` 强制重注册）。
3. 本机每 5 分钟带记录 sync 时 `ensurePublishWebhookLazily`：未注册就注册，失败后 1 小时内不重试；不做远端核对，保持便宜。

当前状态：endpoint `a33292c6-…`，URL `https://factory.tiktokaitool.com/api/integrations/signal-desk/publish-events`，事件 `publish.completed` / `publish.failed`，中台侧 `active=1`。

### 3.6 从中台拉什么

| 用途 | 中台接口 | 分页 |
|---|---|---|
| 账号 | `GET /api/v1/accounts` | 500/页，最多 20 页 |
| 归档 | `/api/integrations/local-factory/archive` | 20 账号/页，每账号 100 视频，每次 20 页、20s 预算，游标存 KV 可续跑 |
| 批次详情 | `GET /api/v1/publish/batches/:id` | 页面 hydrate：已注册 webhook 时 2 个，否则 8 个 |
| 发布统计 | `GET /api/v1/publish/stats` | connectionIds 每 80 个一批 |

### 3.7 cron

`wrangler.jsonc`：`0 0 * * *` 与 `0 16 * * *`（UTC，即北京 08:00 / 00:00），两档跑同一段，每步独立 try（`runScheduledSteps`）：
`persistOpsSnapshots → pruneOfficialOpsReports(90d) → pruneFactoryJobs(30d) → pruneAutoTasks → prunePublishReceipts(30d) → prunePublishRecords(90d) → recomputeArchiveMeta → ensurePublishWebhook → collectFactoryStorageSample`，`backfillMissingAudioDurations` 走 waitUntil。

---

## 4. 中台 Signal Desk

### 4.1 批次创建（`lib/hub-publishing.ts`）

- 每批最多 100 条，预约最远 14 天；batch 按 `externalId` 幂等，task 按 `batch:{externalId}:{externalRef}` 幂等。
- 连接必须 `active` 且带 `video.publish` scope。
- 同账号最小间隔 `TIKTOK_PUBLISH_MIN_ACCOUNT_INTERVAL_SECONDS` 默认 180s；账号间打散 `TIKTOK_PUBLISH_SPREAD_SECONDS` 默认 300s。
- 日配额 `max(5000, 活跃账号 × 10)` 条，1000 号即 10000 条/日。
- 资产：直传 ≤95MB 写 R2 `temporary--{uuid}`；预签名 ≤1GB，有效 1800s。

### 4.2 队列（`wrangler.direct.jsonc`）

| 队列 | 用途 | batch | 并发 | 重试 | DLQ |
|---|---|---|---|---|---|
| `…-publish-prepare` | head R2、签 URL、进 scheduled/queued | 1 | 8 | 8 | 有 |
| `…-publish` | 提交 TikTok | 1 | **4** | 8 | 有 |
| `…-publish-status` | 轮询状态、拿 item_id | 1 | 8 | 8 | 有 |
| `…-sync` | 账号/视频同步 | 1 | 8 | 8 | 有 |
| `…-hub-webhooks` | 投递回执 | 5 | 5 | 3（实际总 ack，靠 DB 重试） | 有 |
| `…-factory-push` | 推给工厂 | 20 | 2 | 8 | 有 |

状态流：`preparing → preparing_media → scheduled|queued → submitting → processing → published | failed | needs_review`。

关键常量：status 轮询 `[60,120,300]s`；缺 item_id 追查 `[120,300,600,1800,3600]s`；status 超时 24h；`submitting` 超 5min → `needs_review`（防重复发帖）；账号锁租约 5min，抢不到 5s 后重试；已有 `publishId` 的任务绝不再 POST TikTok。

### 4.3 限流（Durable Object `TIKTOK_RATE_LIMITER`）

单实例 `tiktok-global` 给所有 TikTok 调用配速：正常 16 rps；收到 429 升级惩罚 8 → 4 → 2 rps，冷却 `[0, 60s, 2min, 5min]`，10 分钟无 429 归零。等待超过 20s 的调用放弃槽位、抛 `Saturated`，由队列稍后重投。无 DO 绑定的环境回落到 D1 单行实现。所有 TikTok 请求经 `pacedTikTokFetch`（`lib/tiktok-auth.ts`）。

### 4.4 回执 webhook（`lib/hub-webhooks.ts`）

- 任务到终态时 `recordPublishTaskOutcome` 写 `hub_webhook_deliveries`（`(endpoint, event, task)` 唯一）；每分钟 cron 取 100 条入队。
- 事件：`published → publish.completed`，其它终态 → `publish.failed`。
- 签名头 `X-Signal-Event / X-Signal-Delivery / X-Signal-Timestamp / X-Signal-Signature: v1=hmac(timestamp.body)`；fetch 超时 10s。
- 失败退避 `[30s,1m,2m,5m,10m,30m,1h,2h,4h,6h]`，10 次后 `exhausted`。
- 自动停用（`deactivateDeadWebhookEndpoint`，规则在 `lib/hub-webhook-policy.ts`）：某条投递 `exhausted` 时，取该端点最近 20 条已结束投递（delivered/exhausted，按 `updated_at` 倒序，走 `0029` 的 `(endpoint_id, updated_at)` 索引），全是 `exhausted` 才置 `active=0`，日志 `hub-webhook-endpoint-deactivated`。之后新终态不再给它写投递；工厂靠每日 verify 重注册，中间漏掉的回执由工厂 08:30 结果同步和页面 hydrate 补。
- 队列 `max_retries=3` 只管 consumer 崩溃，投递失败重试全靠 DB `next_attempt_at`（配置里已注明）。
- 注册 `POST /api/v1/webhooks`（机器密钥），同 URL 重注册会停用旧端点；`GET /api/v1/webhooks` 只列 active 端点。

### 4.5 账号同步与补拉

- 全量：每日 `0 23 * * *`（UTC）一条 dispatch → 每页 500 连接、每 100 条 sendBatch、页间 2s。每账号视频最多 5 页；资料核心字段每天、5 组 insights 每周一次（`_insights_fetched_at`，手动同步始终刷新）。
- 补拉：每 5 分钟，只挑 `published` 且 `item_id=''`、完成超过 30 分钟的账号，按 `lastSyncedAt` 最久优先，40 个/次，单账号 20 分钟冷却；`catchup` 模式只拉 2 页视频并按 ±3h 时间窗回填 item_id。
- **partial index 与绑定参数**：SQLite 只在查询文本里出现与索引 WHERE 相同的字面量时才会用 partial index，drizzle 的 `eq(status, "published")` 生成 `status = ?`，命不中。0026 建的三个 partial index（`published_missing_item`、`open_asset`、`published_completed`）对应的热查询已改成 `sql\`… = 'published'\`` 字面量：补拉候选、`staleItemIdTasks` 重投、成片释放、R2 孤儿清理。新增 `0029` 的 `spam_risk` partial index 给 `loadPublishRiskByConnectionId`（每页 `/api/v1/accounts` 和仪表盘都调）。以后写涉及这些索引的查询要照这个写法。
- token 刷新：`token-refresh:{id}` 锁，租约 30s，最多等 12×1s；过期前 5 分钟内才刷。

### 4.6 cron（`worker/index.ts`）

配置只有 `* * * * *` 和 `0 23 * * *`，按 UTC 分钟细分；每个 job 都包在 `runScheduledJob` 里，失败只记日志不影响同一 tick 的其它 job：

| 频率 | 任务 |
|---|---|
| 每分钟 | 派发到期任务（100 条/次）；webhook 投递入队（100 条/次） |
| 每 5 分钟 | prepare 恢复（100）；publish/status 恢复（50）；释放终态成片 R2（40）；补拉入队（40 账号） |
| 每小时第 7 分 | `runOpsAlertCheck`（阈值告警邮件） |
| 每日 23:00 UTC | 全量同步入队；`cleanupExpiredOperationalData`；归档清理；Cloudflare 存储采样；R2 孤儿清理 |

### 4.7 告警（`lib/ops-alert-policy.ts`）

阈值：`needs_review ≥10`、缺 item_id ≥20、到期未派发 ≥5（15min）、queued 卡住 ≥5（30min）、submitting 卡住 ≥3（30min）、24h webhook exhausted ≥5、**回执端点全部离线（有端点但无 active，直接 critical）**、失效连接 ≥1、限流惩罚等级 ≥2、队列积压 ≥60s、失败率 ≥20%（样本 ≥20）。收件人 `OPS_ALERT_EMAILS`，未配则 `ADMIN_EMAILS`（当前即此）；发信用 `RESEND_API_KEY` + `EMAIL_FROM`；同一告警冷却 6 小时，新告警或升级立即发。管理员可用 `GET/POST /api/admin/ops-alerts` 看快照/手动触发。

### 4.8 保留策略

| 对象 | 保留 |
|---|---|
| `video_snapshots` | 90 天 |
| official 日快照 | 30 天 |
| 终态发布任务（published/failed/rejected/status_timeout/canceled） | 90 天，每次最多删 5000 |
| `needs_review` 未处理 | 7 天后自动置 `failed` |
| webhook 投递记录（非 pending） | 30 天 |
| sync_runs / api_usage / storage 采样 | 30 / 90 / 180 天 |
| R2 临时资产 | 6h；终态任务的成片 5 分钟一轮释放 |

### 4.9 工厂可调的 `/api/v1` 面

鉴权 `requireHubPrincipal`：Bearer ∈ `PUBLISH_HUB_API_KEYS` / `LOCAL_FACTORY_BRIDGE_API_KEYS` / `LOCAL_FACTORY_BRIDGE_API_KEY`（线上配的是最后一个）。

`GET /api/v1/accounts`（500/页，cursor）、`GET/POST /api/v1/publish/batches`、`GET/DELETE /api/v1/publish/batches/:id`、`POST /api/v1/publish/assets(/sign)`、`GET /api/v1/publish/stats`、`POST /api/v1/publish/tasks/:id/retry`（含 needs_review）、`POST /api/v1/publish/tasks/:id/dismiss`、`GET/POST /api/v1/webhooks`。

---

## 5. 容量对照（1000 号 × 3 条/日 ≈ 3000 条）

| 环节 | 当前上限 | 结论 |
|---|---|---|
| 本机日规划 | 3000（`config.json` 已配） | 够；容量校验已把排队任务算进去 |
| 本机渲染 | 2 并发，约 20s/条 | 3000 条约 8.3h，紧；可提 `renderConcurrency`（看 CPU）或加第二台工人 |
| 本机上传 | 1 发布通道 × 10 并行上传 | 够 |
| 中台派发 | 100 条/分钟 | 够（3000 条打散在全天） |
| 中台提交 | 并发 4，限流 16 rps | 够 |
| 中台日配额 | max(5000, 号数×10) | 够 |
| 补拉 | 40 账号 / 5 分钟 = 11520/日 | 够（只处理缺 item_id 的账号） |
| 工厂记录表 | 按 90 天保留，约 27 万行 | 够；D1 单表无硬顶，list 读取仍限 800 |
| 工厂同步写入 | 只写变化行 | 够 |
| D1 单行 | auto-task 一行一任务，各截 80 | 够 |

---

## 6. 复查问题清单

### 已修（2026-09-03 下午，第一批）

1. ★ **工厂设置页保存会抹掉 webhook 密钥。** `POST /api/private-tiktok/settings` 原来整包覆盖 `official-settings`，现在展开原设置再覆盖。
2. **中台 cron 链没有逐项 try/catch。** 每个 job 包在 `runScheduledJob` 里。
3. **工厂 cron 六个维护动作绑在一个 try 里。** 改为 `runScheduledSteps`。
4. **本机运行目录不干净。** 切回干净 `main`。
5. **工厂发布记录按条数裁剪。** 改为 90 天按时间保留；refs 与记录同寿命；同步不再 `COUNT(*)`。

### 已修（2026-09-03 傍晚，第二批）

6. 本机日规划上限 300 → **3000**（`config.json` + example），GeeLark 日上限同步 3000。
7. 本机排产容量只算已完成任务 → `queued`/`running` 任务的 `schedulePlan` 也计入。
8. 本机 `scheduleDateKey` 跟系统时区 → 抽到 `scripts/schedule-date.js`，固定 `Asia/Shanghai`。
9. 本机 `unhandledRejection` 不退出 → `exit(1)` 交给守护。
10. 中台保留策略漏 `status_timeout`/`rejected` → 已加入 `TERMINAL_PUBLISH_TASK_STATUSES`。
11. 中台 webhook 端点不会自动停用 → 连续 20 条 exhausted 置 `active=0`，新告警「回执端点全部离线」，工厂每日 verify 自动重注册。
12. 无界/低效查询：工厂 `hello` 加 LIMIT、账号表读取加 `LIMIT 5000`、回执统计拆成两条索引查询（迁移 0018）；中台 partial index 因绑定参数根本没生效，四处热查询改字面量，新增 `spam_risk` partial index 和 webhook 投递 `(endpoint_id, updated_at)` 索引（迁移 0029）。
13. 密钥双源 → 接口返回 `apiKeySource` / `secretSource`，排障直接看。
14. 权限：`POST private-tiktok/settings`、项目/分组写操作改 admin-only。`auto-tasks`、各 `*/start` 是成员现有入口（GeeLark 自动发布、舒尔特、心理学等），按规则保持原样，没加限制。
15. 工厂 `TRANSCRIPT_QUEUE_CRON` 死代码删除；中台 hub-webhooks `max_retries` 加注释说明。
16. `config.example.json` 补 `autoTasks.dailyPlannedLimit`、`geelarkSafety.dailyPublishLimit`，GeeLark 键名改为代码实际读取的 `apiBaseUrl`，默认 `openapi.geelark.cn`。
17. 仓库根 `jobs/`、`.codex-tmp/` 加进 `.gitignore`。

### 已修（2026-09-03 夜，小说推文业务逻辑第一批）

18. 混剪音频每个任务随机洗牌、无记忆 → 按文件夹组合记游标轮转（`audio-rotation.js`），任务之间接着走，整个文件夹走完才回头。
19. 没推广码的音频照样出片照样发 → 渲染前先解析推广码，没有就跳过该音频；多文件夹任务不再把第一个文件夹的码兜底给其它文件夹。
20. 视频→账号 `i % n` 与音频周期相撞、同一波所有账号同一秒齐发 → 账号分配改成「最少条数里优先没发过这条音频的」，同一波账号在间隔内按 `k/n` 错开。

### 已修（2026-09-04 上午，小说推文业务逻辑第二批）

21. 学习闭环证据门槛（`novel-learning-loop.js`）：以前一个实验的 24h/72h/7d 三次评估就凑够「3 条证据」，100 播放置信度就过线。现在每个实验只投一票（取最成熟的一个窗口），模式要 `confidenceMinTests`（默认 3）个**独立实验**才能晋升/降级；候选视频播放低于 `evaluation.minViews`（默认 1000）的评估记为 `insufficient`，不算证据。策略页「评估与学习」多了「单次评估最少播放」「最低置信度」。
22. 账号归一化：`novel-effect-service.getDecisionContext` 多返回 `accountBaselines`（每个账号近期所有视频的播放/3 秒留存/完播/平均观看比中位数，≥3 条样本才算）。评估时候选和基线的每条视频先除以自己账号的中位数再比，大号发的改写不再天然是「赢」。没有基线的账号回落原始值，评估里有 `normalized` 标记。
23. 改写去重（`script-similarity.js`）：`createScript` 对同一本书的已有版本做词级编辑距离相似度，≥90% 视为同一版本拒绝保存（409 `DUPLICATE_SCRIPT`，`allowDuplicate:true` 可强制）；批量出版本时被拦的版本跳过不整本失败；大脑的 `materializeScriptOptimizations` 改写稿和原稿/兄弟版本几乎一样时不生成音频。同时校验文案里的引导语：搜索码或 App 名和这本书的 `promotionCode`/`platform` 不一致直接拒（400 `CTA_MISMATCH`）。
24. 配音回读校验（`tts-readback.js`）：混剪渲染本来就要用 ElevenLabs 转字幕，现在把转出来的文本和送去 TTS 的原文案（音频记录的 `script`，或库里的 script）算词错率，超过 `ttsReadbackMaxWer`（默认 15%，实测正常 Kokoro 出片在 0.3–3%）就跳过这条音频并写入 `work/tts-readback.json`；没有原文案的音频（同行导入的）不校验。`payload.ttsReadback:false` 可关。
25. 描述多样化（`buildTikTokCaption`）：正文从 12 个模板里按 seed 选（seed = 账号 + 文件名，官方发布、GeeLark 发布、发布记录三处一致），优先用文案第一句 hook 而不是文件名；话题池 10 → 28 个，每条 3–5 个随机。同一本书发 50 个号，描述和话题不再全一样。

### 已修（2026-09-04 下午，模板2 跑酷成片回归）

26. 模板2 在 8 月 28 日（`94ba8b7`）从建任务页藏掉了，后端一直在。现在建任务页（admin + 官方通道）重新出现「选择视频模板」和「跑酷视频目录」；选片从「随机一条、不够就循环」改成 2.4 里描述的「每条只用一次、优先单条、不够拼接、按浪费最少选」，只读目录本层。素材用完任务直接结束而不是把剩余尝试次数耗完。

### 已修（2026-09-04，目录同步）

27. 工人每 5 分钟试一次、每个北京日只推最近 8 个素材/音频目录的定时任务已删。目录清单只认本机「刷新并推送」的全量；5 分钟 `syncInventory` 仍只传发布记录。
28. 工厂云素材使用率页、侧栏、`GET /api/asset-usage` 和工人上传的 `assetUsageDashboard` 已删。使用率只在各台本机查看；多机素材不同，线上无法正确合并。`factory_kv` 里的 `asset-usage` / `asset-usage-dashboard` 由迁移 `0019` 删除。

### 已修（2026-09-04 下午，模板1 素材子文件夹）

29. 模板1 建任务：素材组仍是一级目录，组里按目录树勾选（展开子夹、父夹全选、可单选），混剪只抽勾中的路径（`generation.assetFolders`）。全勾或不传仍抽整组。点开头 / 下划线夹不当素材组。本机可预览素材。模板2 不出现这组勾选。

### 未修（评估后不需要，或超出本阶段）

- 工厂早期迁移 `0004/0005/0008/0009/0011-0013` 的 `ADD COLUMN` 没 `IF NOT EXISTS`：SQLite 语法不支持，wrangler 用 `d1_migrations` 表记录已跑过的文件，线上不会重跑，不用改。
- `compat.js` 里 `GET /api/publish-records` 读旧 KV、`tiktok-analytics*` 空桩、音频库根写死 `F:/音频目录`：GeeLark 备用页的桩，不在官方发布链路上。
- 中台 R2 孤儿清理拉全部 `asset_key != ''`：终态任务 5 分钟一轮清空 `asset_key`，这个集合只有在途任务，且改成字面量后走 `open_asset` partial index，实际有界。
- `config.example.json` 还没有 `factory-cloud-worker.json` 示例。

### 1000 号阶段仍要盯的（不是 bug，是容量边界）

- 本机渲染 2 并发约 20s/条，3000 条/日 ≈ 8.3h 连续渲染，CPU 吃紧就提 `FACTORY_WORKER_RENDER_CONCURRENCY` 或加第二台工人（`workerId` 必须不同，搭建步骤见 2.6 与 `docs/WORKER-SETUP.md`）。
- 中台日配额 `max(5000, 账号×10)`，1000 号即 10000；超过 3 条/号/日要另议。
- 每小时告警邮件是主要感知渠道，收件人回落 `ADMIN_EMAILS`，务必确认能收到。
- D1 rows_read/written 在 Cloudflare 面板看趟势；本轮索引修正后，1000 号规模下每天读写应在免费/付费档内，但没有实测数据，第一周要看。

---

## 7. 排障速查

| 现象 | 先看 |
|---|---|
| 工厂发布记录长时间停在 `submitted` | 工厂 `GET /api/official-publish-records/webhook`（admin）看 `registered` 与 `lastReceiptAt`；中台 `hub_webhook_deliveries` 该 endpoint 的 `status/attempts`；再看本机是否 5 分钟内有 sync |
| 回执 401 | `official-settings.webhookSecret` 与中台 `hub_webhook_endpoints.secret` 不一致（多半是问题 1），先看 `/webhook` 的 `secretSource`，再 admin `POST /api/official-publish-records/sync?force=1` |
| 回执突然停了、中台告警「回执端点全部离线」 | 中台把工厂端点自动停用了（工厂曾长时间不可达）。工厂下一次每日 cron 会自动重注册；要立刻恢复就 admin `POST /api/official-publish-records/sync`（带 verify） |
| 中台任务卡 `queued`/`submitting` | 每小时告警邮件 `stuckQueued/stuckSubmitting`；`/api/admin/ops-alerts` 快照；5 分钟 recovery 会自动重投，`submitting` 超 5 分钟进 `needs_review` |
| `needs_review` 堆积 | 中台发布页管理员「待人工核对」区，重试或放弃；7 天不处理自动关闭 |
| 429 增多 | 告警 `rateLimitLevel`；DO 会自动降到 8/4/2 rps，10 分钟无 429 恢复 |
| 本机没在拉单 | `work/factory-watchdog.json` 心跳、`work/factory-watchdog.log`、`work/server-crash.log`；确认 `workerId=windows-local` 未变 |
| D1 rows_written 告警 | 工厂：`/api/worker/sync` 是否又在传全量（`publishRecordsSyncedAt` 是否被重置）；中台：补拉是否退化成全量（`enqueuePublishCatchupSyncs` 的候选数） |
