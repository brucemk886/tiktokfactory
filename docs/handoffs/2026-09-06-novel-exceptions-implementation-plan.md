# 给 Grok 的实施方案：小说推文统一异常处理

日期：2026-09-06。用户已确定产品方向；本文件为实施任务书，尚未实现功能。

## 1. 目标与范围

在「线上工厂 → 小说推文」增加「异常处理」，聚合本地生产、工人、上传、官方发布、结果同步和内容关联异常。用户不用在三套系统逐个查错；实际处理仍由原系统负责。

主入口建议 /novel-exceptions，模块ID novel-exceptions。Reddit混剪任务页顶部显示待处理异常数量并链接到列表。首版只有管理员可用，遵守现有角色和模块授权，不自动赋予operator。旧管理员通过现有模块迁移机制获得入口，不覆盖其个性化导航配置。

仅官方API小说业务：不接GeeLark、不接中视频/心理学、不改Minecraft或素材策略；不新建小说—文案—音频—视频—效果关联功能，该链路已经存在；不加收益、自动优化策略、自动发布重试或外部消息通知。

线上工厂是异常状态和处理审计的唯一存储；本地只负责报告，Signal Desk仍负责官方发布终态、核查、重试与取消。异常中心不能成为第二套发布队列。

## 2. 开始前与已核实入口

先读AGENTS.md、docs/CURRENT_STATE.md、docs/ARCHITECTURE.md及最近相关handoff，检查git status，保留其他人的未提交修改。

重要现状：官方发布SQLite与v2增量同步已经切生产。复用scripts/publish-record-runtime.js、publish-record-store.js、publish-record-sync.js，不回退到读取大JSON。

重点文件：
- 导航：scripts/sidebar-modules.js、factory-cloud/src/sidebar.js。小说分组id为novel-promotion。
- UI：public/tasks.html/js/css；沿用现有浅色主题/theme-ops.css，不重做页面风格。
- 工厂路由：factory-cloud/src/index.js、compat.js、jobs.js、auth.js。
- 任务存储：factory-cloud/src/auto-tasks-store.js、factory_jobs。注意默认列表200条、最大1000条、任务结果数组压缩到80条；这些展示接口不能作完整异常扫描源。
- 现有任务接口：/api/auto-tasks；/{id}/resume；/{id}/retry-publish，具体状态允许条件在compat.js。名称存在不等于可以安全接入异常中心，必须逐一核实语义。
- 本地：scripts/auto-task-manager.js、factory-cloud-worker.js、server.js、official-publish-result-sync.js。
- 官方结果：factory-cloud/src/publish-records-store.js、publish-webhook.js、publish-records-sync-v2.js。
- 已有账号/视频关联：scripts/novel-effect-core.js、novel-overview.js、novel-effect-service.js；缺videoId时有同账号30分钟邻近时间兜底匹配。
- 工人心跳：jobs.js listWorkerRecords，目前在线窗口10分钟；syncInventory默认5分钟，不能随意改成1分钟无心跳就报警。
- 中台：D:/cursor/tiktokaitool/lib/tiktok-publish-queue.ts、hub-webhooks.ts、ops-alerts.ts、app/publish-batch-console.tsx、发布batch/task API。

最终代码入口以当前仓库为准。对中台修改先读其AGENTS.md。不要从浏览器提取凭据，也不要向浏览器返回桥接密钥。

## 3. 页面与用户操作

顶部：待处理、处理中、严重异常、忽略中；所有数字使用当前权限及筛选范围，不能用当前页条数充当全量计数。另显示各来源最后成功更新时间/来源不可达。

默认显示未解决异常，严重度降序、首次发生时间升序（等待最久优先）。每页20条，服务端分页；可筛选阶段、类型、小说、账号、工人、时间、处理状态。URL保存筛选条件，刷新和从任务返回不丢上下文。

每条展示：
- 严重程度、明确的错误标题、当前处理状态；
- 小说名、文案版本、音频名（缺关联显示“待关联”，不能编造）；
- 账号、工人、关联任务；
- 所属阶段、原始系统状态、精简错误说明；
- 首次发生、最近发生、持续时间、真实重复次数；
- 推荐下一步、查看原任务/前往中台/查看记录按钮。

详情抽屉：关键关联ID、脱敏错误、最近状态变化、处理记录、来源数据新鲜度。不自动播放视频，不默认加载大历史快照。

行为：
1. 查看原任务：用真实路由及定位参数；不存在定位支持就提供已验证的任务列表链接和复制任务ID，不能构造无效深链接。
2. 开始处理：只修改异常工作流并记录操作者，不动业务任务。
3. 已处理/复核：触发有限只读核对；原故障仍存在则保留待处理并说明。支持“人工结案”时必须写原因并明确标注，不能伪装成自动确认恢复。
4. 忽略：原因必填，建议可选1小时/24小时/本次事件。忽略不等于成功、不取消任务；原因/期限记审计。
5. 恢复处理：可取消忽略/重新打开。
6. 首版重试策略：默认只跳转源任务处理。仅当已验证原接口是有权限保护、幂等、且绝不会隐式重复发布的纯生成/上传恢复，才接入明确命名的按钮。不要为了按钮齐全新造重试引擎。
7. 发布失败或needs_review：统一“前往中台核查”，工厂不直接调用retry-publish。

加载失败必须保留错误提示，不能显示“暂无异常”。空状态应同时说明数据覆盖时间。使用现有表格/卡片布局；窄屏可横向滚动或转卡片，操作按钮不能被遮挡。正常轮询只在页面可见时运行，退避并保留当前筛选与滚动位置。

## 4. 第一版异常规则

使用结构化errorCode/stage和源状态，中文错误文案只用作展示。缺结构化分类的旧错误归“其他生产异常”，不能靠模糊字符串猜成授权失败。

| 类别 | 产生条件 | 恢复条件/操作 |
|---|---|---|
| 音频/字幕/混剪失败 | 小说任务明确failed或单条产物失败/needs_attention；部分成功也需发现 | 源任务新尝试成功或对应产物补齐；查看任务 |
| 待人工确认 | 小说流程实际进入awaiting_review等人工关口 | 原任务确认状态推进；信息级待办，不计失败率 |
| 上传/交接失败 | 官方文件上传或中台批次交接明确失败 | 对应文件/任务得到可靠批次接收；查看任务 |
| 工人离线影响生产 | 有明确绑定的小说待执行/运行任务且工人lastSeen超现有离线窗口 | 心跳恢复；同一工人仅一项，显示受影响数量 |
| 疑似无进展 | 工人在线，任务运行中，可靠的阶段进度持续不变超过可配置阈值 | 进度推进或终态；只提示，不杀进程/自动重领 |
| 官方发布失败 | 匹配的中台任务failed/rejected/status_timeout等 | 源任务经合法处理终态变化；前往中台 |
| 发布状态不确定 | 中台needs_review | 前往中台人工核查；严禁自动重发 |
| 发布结果同步失败/滞后 | 明确同步失败，或到期后超宽限仍无可靠状态；未来排期不算 | 成功同步并核对记录；显示“同步异常/待核对”，不推断TikTok失败 |
| 内容关联缺失 | 已发布且videoId/必要内容关联在宽限期后仍未齐；仅小说业务 | 既有关联补齐；跳转小说或记录详情 |

工人有心跳不代表任务有进展。现有工人主要本地读进度，不能未经核实把云任务updated_at当逐条编码心跳：若缺必要进度报告，增加小体积、节流、按状态变化的任务遥测（例如30–60秒至多一次），包含attempt/phase/progress/observedAt。不传全文/大结果数组，不因遥测失败改变生产任务状态。

建议无进展阈值从30分钟开始、上传15分钟开始，仅作为可调默认，需区分长音频、TTS等待、批量任务与已有重试退避。排队等待应单独展示，不当成正在运行卡死。计划停机且无受影响任务不产生离线故障。

账号授权失效可从已有结构化账号/中台错误聚合为一个账号级异常，关联受影响任务，避免同一账号几十条相同告警。

关联缺失不是播放低。数据尚未到达、videoId尚在回填的宽限期内不报警；兜底匹配的记录可标“待核对”，不能宣称所有历史匹配都错误。

取消/归档不是失败。保留历史异常审计，但不为用户主动取消的新任务制造故障。一个批次中的失败视频尽量按产物/remoteTaskId记录，不能只以整个批次失败作为一条无法定位的异常。

## 5. 数据模型：线上D1持久化异常，业务源不变

建议新增factory_novel_exceptions及factory_novel_exception_actions，使用下一空闲migration编号，不硬编码0020（已被SQLite同步改造占用）。

异常字段建议：
- id；scope_key/project_id；owner_id（按现有权限模型）；source(local/factory/signal-desk)。
- entity_type/entity_id、source_instance_id、source_revision或event_id、attempt_id。
- kind、stage、severity、title、message、source_status。
- novel_id、script_id、audio_id、connection_id、worker_id、local_task_id、cloud_job_id、remote_batch_id、remote_task_id、publish_record_id、video_id；可以为空但必须稳定。
- condition_state(active/recovered/unknown)与workflow_state(open/in_progress/resolved/ignored)分开。
- first_seen_at、last_seen_at、last_checked_at、occurrence_count、resolved_at、ignored_until、ignore_reason、resolved_reason、version。
- details_json只存精简、脱敏、有限大小的上下文；不存令牌、签名URL、全文、逐秒曲线。
- canonical fingerprint由权限范围+规范实体+异常kind构成；重复推送不创建重复项。

区分两种重复：
- 同一个event_id/版本的重发和轮询再次发现，不增加occurrence_count。
- 真正新尝试再次失败，增加真实发生次数/episode，并重新打开之前已恢复的异常。

本地/云镜像同一任务需通过taskId/jobId/remoteTaskId等映射归并，不因来源不同生成三条相同故障。同工人离线优先工人级聚合；没有足够证据的下游卡单不层层重复报警。

审计表记录操作者、动作、时间、原因、旧/新工作流状态。PATCH使用version条件更新处理并发；网络重试不重复记同一人工操作，可用requestId去重。

索引覆盖scope+workflow_state+severity+first_seen_at+id分页、fingerprint唯一定位、novel_id/connection_id、active异常的last_checked_at、审计exception_id+created_at。统计SQL与列表必须共享权限条件。不得把所有异常放一个KV JSON。

resolved历史建议保留90天；active/ignored未恢复异常不可按年龄静默删除。清理短批次执行，独立于生成发布队列。

## 6. 收集和一致性

### 云端已有数据

优先从任务状态变更、单条产物结果、官方v2记录同步和中台回执更新异常投影。投影失败不能把已经成功的业务任务改为失败，也不能让发布动作被重复执行；使用持久化待处理标记或后续增量对账修复。

增加服务端增量对账：按source(updated_at,id)游标+固定轮次上界分批扫描，持久化覆盖进度，不扫最近50/200条代替全量。仅对活动异常和变更源更新；页面GET只能读异常表，不能触发全量重建或全量中台请求。

一次拉取失败/列表部分分页完成，不得把未出现的异常当作恢复。只能基于对应实体的新鲜肯定证据恢复。业务源暂不可达时标condition_state=unknown和来源滞后，不把“没有数据”当“正常”。

### 本地数据

需要覆盖本地发起但尚未成功交给云端的小说任务，不然上传前失败永远不可见。

建立独立、本地持久化的小型异常/任务遥测待发送队列，使用已有SQLite连接模式；不要往官方发布记录的outbox中塞不兼容事件。事件来源为实际任务状态变更，初次启用分页回填未解决任务。

仅现有worker身份认证可发送到建议新接口POST /api/worker/novel-exceptions/events。服务端限制该工人的业务范围，字段白名单、条数/字节上限。至少一次投递，event_id幂等；收到持久化ACK才删除/确认本地事件，重启续传。上报不得因网络不可达阻塞渲染；本地持久化失败需记脱敏运行错误，后续源任务对账能够补齐。

### 中台数据

优先用已有publish.completed/publish.failed回执及工厂官方记录。needs_review、授权问题、回执丢失等不能假设现有两个事件涵盖全部。

先核实已有只读API是否能返回小说项目内的相关异常及恢复状态。若不足，在Signal Desk最小增加有权限范围和游标的只读attention/change接口：返回原任务ID、状态、结构化错误、版本、更新时间及实际详情链接。不得重做官方发布状态机。

必须覆盖异常恢复后的变化，不能只提供“当前失败列表”然后因为列表没出现就擅自消除异常。可用变更流或对活动异常逐个/批量查询最新状态；两者均需有限预算。

工厂按分组/已知官方交接关系订阅小说任务，不全量扫描所有中台客户。每轮限制请求、重试、页数和字节；中台宕机聚合一项来源不可达，不为全部账号各造一条。

若增加五分钟Cron，必须按controller.cron分发：当前工厂已有每日维护，不能导致这些全量维护每五分钟运行。优先事件更新+五分钟有界补偿；工厂UI轮询不等于后台运行。

## 7. API建议（这些是新增设计，不是声称已存在）

- GET /api/novel-exceptions：筛选、游标、limit，返回items/nextCursor/sourceFreshness。
- GET /api/novel-exceptions/summary：当前权限及筛选下的计数，供任务页徽标使用。
- GET /api/novel-exceptions/:id：详情+分页审计。
- PATCH /api/novel-exceptions/:id：开始处理、忽略、恢复处理、申请复核；reason/version/requestId。
- POST /api/worker/novel-exceptions/events：机器上报，不允许浏览器直接使用机器凭据。

所有列表、summary、详情、修改都在服务端鉴权，不能只隐藏侧边栏。管理员也只按现有项目/租户范围读取，不因为role=admin跳过必要归属限制。外部跳转链接由服务端从可信base URL及已知任务ID构造；协议/主机白名单，不接受上报任意javascript/data URL。所有错误说明和小说标题做HTML转义。

主入口只在云工厂提供完整处理。本地侧边栏如需相同入口，跳转已有配置的线上工厂/novel-exceptions，不建立独立本地异常管理库和人工状态。云工厂不可达时明确提示并保留本地事件补传。

## 8. 实施拆分与文件建议

A. 核实源状态和权限映射；写纯函数规则、fingerprint/episode/state transition及行为测试。
B. D1表、异常存储、分页API、审计和服务端权限。
C. 云任务/官方回执/v2同步投影、本地报告与有界对账；必要时最小中台只读适配。
D. public/novel-exceptions.html/js/css及导航；tasks页顶部徽标；实际跳转定位。
E. 只读dry-run统计+初次未解决异常回填；灰度验证。

可新增：factory-cloud/src/novel-exceptions.js、novel-exceptions-store.js、novel-exception-rules.js；scripts/novel-exception-reporter.js；public/novel-exceptions.*。如果规则要本地共用，抽到共享纯函数模块。按现有架构调整，不强制堆成一个大文件。

初次回填默认只纳入当前未解决且仍相关的任务，不把数月前已结束故障全部弹成待办。使用dry-run查看分布再执行启用步骤；不修改旧任务真实状态。

## 9. 必须验证

- 同一错误重复投递10次只有一项、真实发生次数不乱增；本地/云镜像归并。
- 新attempt再次失败会重开；旧乱序失败消息不覆盖已恢复的新版本；恢复证据缺失保持unknown。
- 标记忽略/已处理不改业务status、不取消任务、不发视频。忽略到期且故障仍在恢复待处理。
- 第201、1001条任务以及任务第81条失败视频能进入异常列表，不受展示截断影响。
- 部分成功的批次准确显示失败产物；取消不是失败；needs_review绝无工厂自动重发。
- 工人10分钟窗口、未来排期、长视频持续有进度、重试等待、来源断网不误报。
- 本地事件离线积压/重启/ACK丢失可补传；对账游标跨页及新变更无遗漏。
- 来源API部分分页失败不能清除尚未核对异常；工厂投影写入失败不反向让业务任务失败。
- 未登录/无模块权限/operator/跨项目请求、伪造ID、机器token滥用均被拒绝；summary也不能泄漏计数。
- UI查看、筛选、分页、详情、忽略原因、并发修改冲突、恢复处理、跳转任务、加载失败与真实空状态。
- 用隔离合成数据验证90000条任务、1000账号、10000条异常的列表和计数；记录p50/p95、SQL计划与对账请求量。不得页面加载全量源数据。
- 查看当前cron调度，新增补偿不会每5分钟跑一遍每日清理/报告。
- 回归现有任务、官方记录v2同步、回执合并、权限和导航测试。真实发布API在测试中禁止调用。

## 10. 交付与上线边界

交付代码、迁移、测试报告、源状态映射表、阈值默认值、回填dry-run结果、权限说明、UI实际截图及验证范围、handoff。

当前工作区有他人未提交改动，尤其public/tasks.*；只能做必要局部改动，不能覆盖/回退。工具不可用或页面无法登录时明确标记未验证，不能声称截图验收通过。

本次执行默认完成开发和离线验证，不自动重启正在执行的任务、不发送通知、不执行真实重试、不发布部署。生产部署必须按仓库规定：提交推送GitHub main、干净工作区、HEAD==origin/main；factory-cloud只用npm run deploy；中台只在其仓库用npm run cloudflare:deploy。线上实际变化后才更新CURRENT_STATE的上线描述。

验收核心：用户能在小说推文里看到真实、去重复、可定位的异常；知道哪个系统负责处理；人工忽略与真实恢复分清；工厂不会因异常中心多发视频、丢异常或泄漏其他项目数据。
