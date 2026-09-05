# 给 Grok 4.6 的实施任务：发布记录 SQLite 化与可靠增量同步

## 任务与边界

你负责在 D:/cursor/localfactory 实施以下两项改造：
1. 仅把本地 publish-records.json 中官方API发布记录的运行时读写迁移到 SQLite，消除每条官方发布记录重复携带账号历史快照的问题。
2. 把工人“先截取前800条再筛选更新”的同步，改成可恢复、分页、持久化确认的增量同步。

用户最终范围：后续只用官方API。GeeLark记录不迁移、不改造其业务功能，也不要求专门完善其测试；原JSON及其中GeeLark历史完整保留。共享入口只做官方记录读写分流，避免误删、误转源或把官方新记录继续写回旧文件。

目标规模：1000账号、每天3000条小说混剪视频。只改这两个问题及其必要调用方、云端接收协议、迁移和测试。不要改 Minecraft、素材策略、渲染、排期、TikTok/GeeLark发布动作、账号授权规则或页面风格。

先读 AGENTS.md、docs/CURRENT_STATE.md、docs/ARCHITECTURE.md、docs/handoffs/2026-09-05-three-system-scale-audit.md，检查 git status。已有其他人的未提交修改，必须保留。本文代码行号只作定位，实施前以当前代码为准。

默认完成代码、离线测试和可审查迁移工具，不自动执行生产切换、重启、部署或删除旧文件。不要中断正在渲染/发布的任务；测试不得调用真实 GeeLark/TikTok发布API。生产部署仍必须遵守仓库先提交推送main、工作区干净且HEAD==origin/main的要求。

## 已核实的问题与入口

- D:/localfactory-data/work/publish-records.json：检查时3762条、154834589字节，混有官方与GeeLark记录；不是全为官方记录。
- officialAccountSnapshots 紧凑序列化累计约44.4MB，同账号历史被附在不同视频记录中重复保存。
- scripts/official-publish-result-sync.js:195–208：把 officialVideo、officialAccountProfile、officialVideoSnapshots、officialAccountSnapshots 放回每条发布记录。
- scripts/auto-task-manager.js:1241 persistOfficialPublishRecords：读整个JSON、合并、写整个JSON；625附近清理逻辑也依赖旧文件。
- scripts/server.js:3704附近 readPublishRecords/writePublishRecords/appendPublishRecords，以及118–119附近注入结果同步服务的回调。
- scripts/publish-service.js：GeeLark历史模块仍读写同一JSON，此模块不在实施范围；不要迁移它。仅确保共享官方读写入口不再通过该文件持久化官方更新。
- scripts/factory-cloud-worker.js:711 syncInventory、771 readOfficialPublishRecords、785 recordsChangedSince：slice(0,800)发生在增量筛选之前；进度只保存在内存 publishRecordsSyncedAt；setInterval还可能发生同步重叠。
- scripts/official-publish-records.js:3 mergeOfficialPublishRecords 内含 slice(0,3000)。它被本地和云端调用，持久化、迁移和全量处理不能被这个展示性限制静默截断。
- factory-cloud/src/jobs.js：POST /api/worker/sync接收记录。
- factory-cloud/src/publish-records-store.js：D1已经有记录、引用索引、回执表，保留现有幂等合并与回执优先语义，不要另造一份云端记录全集。
- scripts/official-analytics-archive.js：已有 node:sqlite、账号/视频每日快照和最新数据表，默认数据库位于 workDir/official-tiktok-history/official-history.sqlite。
- scripts/asset-usage-impact.js等消费者读取record.officialVideo.views，迁移后不能变成空数据。

实施前再次全仓搜索 publish-records.json、四个嵌套字段、mergeOfficialPublishRecords 的读写调用，将官方调用方与GeeLark历史调用方标清。迁移全部官方写入者；GeeLark历史调用方标为范围外。

## 一、存储设计

### 1. 统一存储层

新增 scripts/publish-record-store.js，并按需抽取轻量SQLite连接模块。遵循仓库现有node:sqlite用法，检查实际Node版本。不得为使用存储而启动归档定时任务、外部同步或其他业务服务。

优先在现有 official-history.sqlite 中增加发布存储和同步表，复用现有账号/视频快照表。这可以让记录更新、快照更新、同步事件在同一个SQLite事务内完成，也避免同时维护两套账号历史。提取公共连接/迁移函数，保留现有数据库内容和归档服务契约。

数据库路径必须由workDir配置解析，不在业务代码硬编码D盘。每台机器使用自己的本地数据库；不要让两台机器在共享网盘上打开同一个SQLite文件。使用WAL、合理busy_timeout、短事务、版本化迁移；事务里禁止网络请求和大文件操作。

### 2. 建议表结构（实现时补充必要列和索引）

publishing_records：
- record_key TEXT PRIMARY KEY：内部唯一键。本次仅provider=official，结合原始id/dedupeKey等生成确定性键；不得因迁移改变已有对外id和云端引用。
- public_id、provider、connection_id、video_id、task_id、batch_id、external_ref、dedupe_key、file_name。
- status、created_at、updated_at、scheduled_at、revision。
- record_json：保存未知/兼容字段的精简JSON，但不得再内嵌账号/视频快照数组；共享profile/video详情也走关联读取。
- 索引覆盖provider+created_at+record_key分页、provider+status+scheduled_at待处理查询、connection_id、video_id、dedupe_key、file_name清理查询。
- 保留原始毫秒/秒字段的对外格式；数据库内部时间单位统一并明确转换，不能直接改变现有scheduleAt语义。

publishing_outbox：
- seq INTEGER PRIMARY KEY AUTOINCREMENT。
- record_key、record_revision、operation、payload_json、created_at。
- payload_json是该版本不可变的精简官方同步数据，不包含账号历史大数组。不要发送事件时临时取“当前记录”替代旧版本payload。
- 只为实际改变了对外同步数据的官方记录创建事件；GeeLark不发送到官方云端；纯账号快照刷新且精简记录未变时不必制造无意义事件。

publishing_sync_state：
- destination_key PRIMARY KEY、source_store_id、acked_seq、updated_at。
- destination_key区分目标云端及同步身份，不保存API密钥；source_store_id为持久化随机源库标识，不能使用每次启动变化的pid。
- 复制数据库到第二台机器时必须生成新的source_store_id并重置其确认状态，不能沿用另一台机器的发送身份。

publishing_migrations：版本、导入批次、状态、源文件摘要、计数与校验结果。不保存凭据或正文。

### 3. 快照去重复与兼容

- 复用现有account_daily_snapshots/account latest、video_daily_snapshots/videos_latest等表及唯一键；迁移前核实account_key与connectionId/schema的映射。
- 同账号同日期只存一份快照；同视频同日期只存一份。相同数据重复写入不增长行数。
- 同日冲突：优先较新synced_at；避免用缺失字段覆盖已有有效字段，采用稳定且可测试的合并规则。不把不同来源、账号或日期强行合并。
- 没有可靠账号键、日期或记录ID时，不得静默跳过。隔离到本地迁移异常表/文件，保留完整原始数据，提供脱敏错误清单；存在未处理异常不能宣称无损迁移完成。
- 检查已有快照JSON也不会间接包含整个快照列表，避免把重复换个地方存。
- 列表只返回精简字段；详情/历史通过按需关联恢复旧的响应字段。内部统计改查对应表，不为全量记录重新附加历史数组。
- 更新selectDueOfficialPublishRecords依赖：改查视频当天快照是否存在/已同步标记，不再靠record.officialVideoSnapshots数组判断。
- 保持asset-usage-impact及小说效果等消费者读取播放量的语义。

### 4. 存储接口建议

getRecord(key)、upsertRecords(records)、patchRecords(patches)、listRecords(filters,cursor,limit)、getRecordDetail(key)、summarizeRecords(filters)、findByDedupeKey、listDueOfficialRecords、findByFileName、readOutboxPage、ackOutboxPage。

正常更新必须是字段补丁/按键upsert。不要保留“读全库数组再writeRecords覆盖全库”的假SQLite实现。短期兼容适配器不得删除未出现在传入数组中的记录。

导入前先用现有可靠来源判定筛选官方记录，再调用官方normalize函数；禁止对整份混合JSON直接normalize后导入。来源不明的记录隔离待核对。GeeLark数据留在原JSON中；共享列表/清理函数只调整官方数据获取，不能以迁移为由重写或清空旧文件。

单条写入事务：读取旧值 → 合并并增加revision → 保存精简记录及相关快照 → 若官方同步payload发生变化，插入outbox → 提交。任一步失败全部回滚。

## 二、可靠分页同步设计

说明：对外仍是“游标分页”，但游标采用数据库单调递增seq，而不是电脑updatedAt。这样旧记录更新、同毫秒写入、时钟回拨都不会被漏掉。

### 1. 工人发送

- 把官方发布记录同步与五分钟库存/设置同步解耦，可保持同一调度入口，但有独立确认状态和单飞锁。
- 一次发送轮次开始读取MAX(seq)作为upperSeq。
- 查询ackedSeq < seq <= upperSeq ORDER BY seq LIMIT 200，同时限制序列化字节数，建议单页最多512KiB；超大单条须报错并保留重试，不得跳过后推进水位。
- 发送不可变事件页，成功后持久化该页最后seq，再处理下一页。
- 每轮有时间/页数预算；预算到达时保存进度，安排下一轮续传。不能在大积压下永远重复第一页，也不能一次阻塞整个工人。
- 上轮未结束时不再开启第二轮同一目标同步。若同库可能有多个进程，需数据库租约或唯一同步执行者约束；仅内存布尔值不能保护多进程。
- 应用级请求超时、有限重试、退避；所有错误都保留未确认页。
- 进程重启继续从已持久化ackedSeq发送；不使用“启动时间”或“本轮开始时间”直接推进确认。

建议独立协议接口 POST /api/worker/publish-records/sync：
请求：protocolVersion=2、sourceStoreId、workerId、afterSeq、throughSeq、events[{seq,recordRevision,record}]。
响应：protocolVersion=2、sourceStoreId、ackedThroughSeq、acceptedEventCount。

seq不要求每个整数都连续，但请求顺序和页边界必须验证。普通{ok:true}不能作为v2确认；响应必须匹配本页sourceStoreId与throughSeq。无效或部分确认不推进本地水位。

### 2. 云端接收

- 复用worker-token认证，验证payload、来源身份、页条数和字节限制。
- 复用现有factory_publish_records、refs与receipt合并逻辑，保留“线上确定终态不会被本地旧submitted覆盖”。不要用简单status排序代替业务状态转换；合法重试需要新的尝试/版本语义。
- 新增轻量源版本/事件去重元数据，按(sourceStoreId,recordKey)记录已应用revision，重复或较旧版本必须安全忽略。
- 同页出现同一记录多次更新时按revision/seq正确应用，不能让较早事件覆盖较新事件。
- 分块写入若中途失败不得返回整页成功；重试整页必须幂等。只有整页所有事件已成功处理或已确认重复时才返回完整ACK。
- 数据写入与“版本已应用”的记录必须在同一事务中提交，防止版本已标记但正文没落库。
- 不依赖旧KV fallback来宣称v2成功。必要D1表缺失应明确报错，工人保留积压。
- 兼容旧工人的现有/api/worker/sync，避免部署顺序导致现有生产失效；新工人不能对只支持旧协议的服务器发送后误确认。先上线兼容云端，再切换新工人。
- 如果同一业务记录会从两台机器回传，保留既有全局记录ID/引用，明确云端归并规则和回执权威性；不可把不同源的seq相互比较来决定新旧。

### 3. 清理与补偿

- outbox只清理已被所有有效目标确认、且超过保留窗口的事件；未确认事件永不按条数直接截断。
- 本次不引入新的记录删除同步。如果现有功能确有业务删除，必须用墓碑事件覆盖，而不是删除后期待同步方猜测。
- 新目标、源库恢复或ACK失配要提供显式全量重建同步命令：分页读取所有官方记录生成新的基线事件；不能退回前800条，也不能默默跳过未知游标。
- 去重元数据保留窗口应覆盖允许重放窗口；从旧备份恢复需更换源库epoch/身份并重新建立基线，避免复用旧revision导致云端忽略新变化。

## 三、迁移与上线步骤

### A. 开发与dry-run

1. 用合成数据开发存储/快照/协议和测试；不能把真实账号数据复制进Git测试夹具。
2. 迁移工具支持dry-run，仅输出行数、provider/status分布、ID异常、预计去重复快照数、字段缺失和校验结果。
3. 使用受控读取的源快照测试导入；原JSON保持完整。源文件读取失败、JSON损坏不能按空数组继续。
4. 迁移按有限批次提交，记录进度，支持重跑/中断恢复且不重复插入；迁移提交到新表不等于已经启用新存储。

### B. 正式切换（不要本次自动执行）

1. 确认所有旧JSON写入者已进入协调的安全切换状态，且没有活动渲染/发布会受影响。文件hash检查只能发现变化，不能替代写入锁/安全窗口。
2. 创建JSON原样备份和SQLite一致性备份，保存摘要。SQLite备份须包含已提交WAL数据；不能只复制一个正在使用的.sqlite主文件。
3. 导入全部官方记录和关联快照，生成这些官方记录的初始outbox事件，校验完成后写migration-complete标记。
4. 校验：所有官方源记录都能一一对应到导入记录或明确待处理异常；官方status/账号关联/视频ID/批次/排期/查重键均保留；不同日期历史不丢；确认关联冲突已处理。另核对原JSON及GeeLark历史未被修改，不将其计入官方导入数量。
5. 所有官方读写调用方统一切SQLite。不能让旧进程继续向JSON写官方更新、新进程向SQLite写官方更新；不使用无可靠事务保障的长期双写。GeeLark旧数据仍留在JSON，不能再作为官方运行时兜底数据源悄悄合并。
6. 再建立增量同步，确认多页补传和ACK保存。旧JSON作为备份保留，不自动删除。

### C. 回滚

- 切换前失败：旧运行时保持原状，隔离未完成导入状态。
- 切换后已有新写入：不得仅恢复最初JSON，否则会丢新记录。先进入安全窗口，从SQLite一致性导出官方记录（按需还原快照字段），仅替换回滚文件中的官方部分，并完整保留当时JSON里的GeeLark及其他历史部分；校验官方记录与关联，再切回旧官方读写路径。
- 云端已接受的记录不盲目删除或重发；保留源身份与确认记录，按幂等恢复。

## 四、必须通过的测试

### 数据与迁移
- 混合JSON的来源过滤：仅导入官方，GeeLark原始文件内容保持不变；来源不明明确报告。其余覆盖官方重复ID、缺失ID、无效日期、同账号多视频、同日多份快照、相同videoId不同账号边界。
- 同账号100条视频引用30天历史，快照行数只增加30条，不是3000条；发布记录JSON不含快照大数组。
- 最新/历史字段和未知业务字段保留；官方列表/详情/统计/播放归因/待同步筛选/清理保持语义；不新增GeeLark业务改造要求。
- 导入0/488/90000条官方合成记录（审查时3762条总记录中官方为488条，执行时重新统计）；重跑不重复；中途失败可恢复；JSON损坏明确失败，绝不当空库。
- 记录与outbox事务故障回滚；两个SQLite连接/进程并发修改不同记录，不丢数据。

### 增量同步
- 初始5000条以200条分页全部到达；新增和更新都同步，尤其创建时间很旧但刚刚更新的记录。
- 801/3001/5001条边界；同毫秒多条、时钟回拨、同记录一轮内多次更新。
- 第三页失败只续传未确认页；云端已落库但响应丢失时重放无重复行和状态退化。
- ACK落盘前/后崩溃、云端分块写到一半失败、数据库busy、网络超时、401/429/5xx。
- 发送期间新增seq>upperSeq留到下一轮；大积压分轮能最终排空。
- 并发定时触发不出现重复同步循环；源A确认不影响源B；切换目标不能沿用其他目标游标。
- 回执先到/后到；本地旧submitted不能覆盖线上published/failed；未知协议ACK不推进。
- outbox清理不删未确认事件；备份恢复和全量重建验证。

### 规模与回归
- 90000条合成发布记录、1000账号×30天快照；只在隔离目录运行。
- 给出迁移时间、DB体积、分页/补丁写入p50/p95、峰值RSS、同步总页数、查询计划；快照体积应随账号/日期增长，而非账号下视频数倍增。
- 官方热路径不得readFileSync旧大JSON，不得SELECT全部记录再分页，不得为更新一行重写全库。
- 用EXPLAIN QUERY PLAN证明分页/增量/待处理查询有合适索引。
- 执行现有相关测试及新增行为测试；不要只增加正则检查实现代码。测试不得访问真实发布API、修改生产库或触发生产清理。

## 五、完成定义及交付物

交付：
1. 代码改动、数据库迁移、JSON导入dry-run/执行/校验工具、一致性导出回滚工具。
2. 完整官方读写调用方适配清单，标明兼容层和未改动的GeeLark范围外调用方。
3. 离线行为测试和规模基准结果，明确机器及测试条件。
4. 部署/安全切换/回滚操作说明，明确哪些步骤尚未执行。
5. docs/handoffs新增交接；只有实际生产状态改变时才更新CURRENT_STATE的已上线描述。

验收底线：官方旧数据不丢；GeeLark原文件历史不受损；官方业务行为不变；记录不再重复内嵌共享快照；记录数量增长不会触发800/3000条静默截断；网络中断/重启/重复传输不漏更新；线上终态不被旧本地状态倒退覆盖；未确认同步数据不会被清理。

不要把“离线测试通过”写成“已上线迁移成功”。本任务最终应明确区分：代码完成、测试通过、迁移工具就绪、生产是否切换。
