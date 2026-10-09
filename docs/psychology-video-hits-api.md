# 心理学视频爆款 API

页面：`https://factory.tiktokaitool.com/psychology-video-hits`。在页面点“API 写入”可复制 GPT / Dot 完整指令。使用“统一 API”现有项目密钥，不需要新增专用密钥。

页面流程：视频列表点击“查看二创”进入独立二创列表，按版本编号列出该视频的全部二创；点击“查看详情”进入原文案 / 二创文案与逐帧原图 / 二创图对照。支持直接打开、刷新和返回。点击图片或右下角放大镜可放大、缩小或查看原始尺寸；“修改原图 / 修改二创图”用于手动替换图片或修改该帧文字、时长，不会自动生成图片。

页面按版本的 inputMode 自动标记导入类型：video 显示“视频”，frames（含旧数据默认值）显示“图文”，表示传入图片和文案、后续可合成视频。来源列表显示各类型数量，二创子页面按类型与发布状态组合筛选；刷新和进入详情后返回保留类型筛选。已清理记录仍保留类型标签；已有 API 导入无需重新写入。

## 调用入口

- JSON：`POST https://factory.tiktokaitool.com/api/v1/factory`
- 请求头：`Authorization: Bearer <PROJECT_API_KEY>`、`Content-Type: application/json`
- 目录：`GET /api/v1/factory?module=psychology`，查看 `videoHits.*`。
- 每次写操作的外层 `requestId` 是 UUID。重试沿用原编号。更新前读取最新 `revision`。
- HTTP 409 REQUEST_IN_PROGRESS / 503 RESULT_UNKNOWN 时使用 `psychology/requests.get` 查询原请求，不换 UUID 重复提交。

## 来源与版本

`videoHits.create` 保存 `externalId`、TikTok `videoUrl`、`title`、`caption`（发布文案）、`script`（完整视频原文）和 `videoData`（JSON，最多16KB，推荐 playCount/likeCount/commentCount/shareCount/favoriteCount/durationSeconds/accountName/publishedAt）。externalId 在当前账号内唯一；修改使用返回的 id 和 revision。

`videoHits.list` 支持 page/q/sort（recent 或 plays）、scope（active/archived/all）及 inputMode（all/video/frames，默认 all）；每页20条。inputMode 放在 params.query 中：video 筛选含视频二创的来源，frames 筛选含图文二创的来源，筛选在分页前执行。同一来源可同时包含两种二创，不会重复返回。每条来源附带 videoVersionCount、frameVersionCount 和总 versionCount。`videoHits.get` 返回来源、最新revision和版本。`videoHits.update` 按revision修改来源。

每个来源有1–20号独立二创版本，用 `videoHits.versions.write` 创建/编辑。新版本 revision=0；后续读 `videoHits.versions.get` 取最新revision。字段为 name/title/caption/script/enabled。新版本默认停用，文案和图片补齐后提交 enabled=true。

## 图片上传

推荐把实际图片字节上传到私有R2，避免临时外链过期：

```http
PUT /api/integrations/psychology/video-hits/assets/GENERATE_UPLOAD_UUID
Authorization: Bearer <PROJECT_API_KEY>
Content-Type: image/png

<实际 PNG 文件的二进制字节>
```

支持PNG/JPEG/WebP，每张最多8MB。返回assetId。同一上传UUID只能写相同字节和类型，冲突返回409。私有预览按当前所有者权限读取，不对匿名用户开放。

JSON接口不接收图片二进制/base64，也不把 sandbox: 文件路径当图片链接。调用端需要读取真实文件后上传；不能读取时，可使用持久公开HTTPS域名图片链接。图片链接不允许本机、私网IP、凭据或自定义端口；下载时验证解析和重定向地址。

## 逐帧写入

`version:"0"` 表示原图；`"1"`–`"20"` 表示对应二创版本。每套最多300个分镜帧，index从1连续编号，每次写1–100帧，可分批补充。这是场景/分镜图片序列；成片由FFmpeg输出30fps，不要求上传每个编码视频帧。

```json
{
  "module": "psychology",
  "action": "videoHits.frames.write",
  "requestId": "GENERATE_A_UUID",
  "params": {
    "id": "SOURCE_ID",
    "version": "0",
    "body": {
      "revision": 1,
      "frames": [
        {"index": 1, "assetId": "UPLOAD_UUID", "text": "本帧画面文字", "durationSeconds": 3},
        {"index": 2, "imageUrl": "https://images.your-domain.com/frame-2.png", "text": "下一帧", "durationSeconds": 4}
      ]
    }
  }
}
```

每帧只能选assetId或imageUrl之一，text最多1500字，durationSeconds为0.04–60秒。二创帧写入会停用该版本并递增其revision；原图写入会停用所有版本并递增各版本revision。写入文案/图片均不会发布。图补齐后再次启用。

`videoHits.frames.list` 带params.id/version和query.page读取，每页对应20个帧号，便于缺图版本与原图对齐。启用要求原图与二创帧从1连续、帧号完全对应，且有title及完整script，总参考时长不超过30分钟。

## 合成与发布

1. `videoHits.render`：params.id、version、body:{revision,voiceGender:"female"}。同一当前版本与来源revision/声音使用稳定任务ID，换requestId不会重复创建；male/female沿用现有ElevenLabs声音。逐帧图片加可选画面文字，按相对durationSeconds对齐实际完整配音，合成9:16 MP4。不会调用生图模型或改写模型重新生成内容。
2. `videoHits.jobs`：读取最近20个该版本合成/发布任务及publication真实发布状态。页面可准备私有云端预览；“成片与发布”读取成片并按现有人工选片流程发布。
3. `videoHits.publish`：图片模式创建真实“合成→上传→官方中台排期”任务；已合成视频复用原MP4，成片模式跳过合成。先用publish.accounts取得当前心理学授权账号。

```json
{
  "module":"psychology",
  "action":"videoHits.publish",
  "requestId":"GENERATE_A_UUID",
  "params":{
    "id":"SOURCE_ID",
    "version":"1",
    "body":{
      "revision":3,
      "connectionIds":["AUTHORIZED_PSYCHOLOGY_ACCOUNT_ID"],
      "scheduleAt":1900000000,
      "intervalMinutes":60,
      "isAiGenerated":true,
      "voiceGender":"female"
    }
  }
}
```

排期为秒级Unix时间，待合成图片至少30分钟后；直接传入或已完成合成的成片至少5分钟后，均在14天内。每个二创版本全局只允许一个发布账号和一个持久发布任务，失败重试原任务。可选minFollowers:1000和tiktokOne:{connectionId,accountId,campaignId}，复用现有粉丝与项目加入校验。

所有任务冻结来源/版本revision、图片、标题、完整配音文案、发布文案、账号和时间。后续编辑不修改既有任务。当前权限在创建、领取、图片读取和发布时复核，最终状态由现有官方发布记录/Signal Desk负责。

新的显式合成/发布API不会启动或恢复旧心理学自动规划。GPT/Dot只在其当前任务已获发布授权时调用publish；只有写入授权时结束于版本启用或render。

## 运行支持

新工作类型为psychology-video-remix。旧工人因能力门槛不会领取。更新后的正常工人内置执行；已有运行中的工人可用scripts/psychology-video-remix-agent.mjs并指定原工厂目录作为辅助渲染进程，不报到、不重排、不重启既有工人，只领取显式二创任务。正常官方发布通道负责合成后的上传与合批。

发布确认后的素材由下方生命周期策略自动清理。API不会下载或解析原视频；解析和二创由调用端GPT/Dot完成，再把原文、原图和二创资产写入。

## 两种输入方式（0081）

图片版保留原来的默认行为：inputMode为frames（可省略），须有完整script、原图及对应二创图片，补齐后启用。页面点击合成显示“已提交合成”，成功结果显示“已合成”。上传成片本身不会创建发布任务。

成片上传使用同一个项目Bearer密钥：

```http
PUT /api/integrations/psychology/video-hits/videos/UPLOAD_UUID
Authorization: Bearer <PROJECT_API_KEY>
Content-Type: video/mp4
X-File-Name: recreation.mp4
X-File-Size: <actual bytes>
X-Content-SHA256: <lowercase 64-character SHA256 of actual file>

<binary video file>
```

支持MP4、MOV、WebM，最多95MiB；文件名使用encodeURIComponent编码，Content-Type依次为video/mp4、video/quicktime、video/webm。返回videoAssetId。私有R2流式写入，验证长度、容器头和SHA256；同一上传UUID只能重试相同文件/名称/类型/大小。摘要由R2校验，依据[Cloudflare Workers R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2putoptions)。

然后保存版本：

```json
{"module":"psychology","action":"videoHits.versions.write","requestId":"GENERATE_A_UUID","params":{"id":"SOURCE_ID","version":"1","body":{"revision":0,"inputMode":"video","videoAssetId":"UPLOAD_UUID","title":"二创成片标题","caption":"发布文案","enabled":true}}}
```

成片版不要求原图、二创图或script；无需调用render。调用同一个videoHits.publish完成上传中台、排期和官方发布。可选TikTok One参数与原流程相同。页面支持选择一个授权账号、排期和明确AI标识后提交。

一旦提交发布，版本绑定publishItemId，后续新UUID、换账号或编辑版本都不能重新分配。成片文件的owner+SHA256也只允许分配一次，换上传UUID不能绕过。未确认或失败任务保留原发布身份。中台接收/排期不等于已发布；已发布状态和发布链接另存D1，即使一般任务/回执被修剪，仍保留版本防重记录。旧版本已有的发布分配通过迁移保留。

## 自动清理（0082 / 0083）

图片及传入成片保存在 Cloudflare 私有 R2；来源、版本、发布身份和防重摘要保存在 D1。只传外部 imageUrl 的图片仍由外部服务保存，Factory 只能清除引用，不能删除其他网站文件。上传到 Signal Desk / TikTok 的文件遵循各服务自己的保留期，本功能仅清理 Factory 管理的素材。

官方记录确认 published / publish_complete 后立即移出页面默认“待发布”列表，进入“已发布记录”。确认时间满 24 小时后，五分钟维护任务会清除该版本的文案、画面文字与分镜引用、已完成任务内的重型二创快照，以及未被其他版本或未结束任务引用的二创 R2 图片、成片与合成预览。来源、标题、版本编号、发布账号/时间/链接和文件摘要防重记录继续保留。版本编号不回收，删除文件也不能再次发布这个版本。

图片输入和直接成片输入采用相同规则。排期/中台接收/提交成功均不算发布成功；失败、取消和结果未知版本保留。未发布草稿不自动过期。没有绑定到来源/版本/任务的上传满 24 小时后回收，上传中断也会留下可回收清单。正在排队/运行中的任务和最近七天失败任务的冻结引用会保护素材；失败版本自身的素材继续由版本引用保护。

原图保留供新版本二创使用。全部已创建版本均已确认发布后，可在页面点击“结束来源”或调用 videoHits.archive；结束后不能再新增/修改内容，满 24 小时并且全部版本已经清理后，删除原文、原图引用及不再被其他来源引用的原图。已结束来源默认从来源列表隐藏，可在“已结束”筛选查看记录。

```json
{"module":"psychology","action":"videoHits.archive","requestId":"GENERATE_A_UUID","params":{"id":"SOURCE_ID","body":{"revision":SOURCE_REVISION}}}
```

videoHits.cleanup / GET /api/psychology-video-hits/cleanup 返回 policy（含 localStaleMinutes:15）、versions、images、videos、previews、local 和至多十条待重试错误（含本机清理失败）。versions.cleaned 表示文案及素材引用已清理，实际 R2 与本机文件删除分别查看 images/videos/previews/local；共享文件继续保留。页面“清理状态”显示同一信息；来源列表 query.scope 为 active（默认）、archived 或 all。

R2 文件清理先用事务检查所有引用并标记 deleting，阻止并发新绑定，再删除精确对象。失败会保留清单，按最近尝试时间轮转重试，避免少数坏文件挡住整批清理；晚到上传通过清理代次保护和持久补偿清单再次回收，旧删除回执不能覆盖新一轮重试；完成后标记 deleted，保留不可复用的上传身份及原存储键，私有预览返回 410。不按整目录或整个 R2 前缀删除。

合成结束或失败后立即清除该任务专属的分镜下载、配音、字幕和临时图片；外部输入音频不删除。发布确认并完成版本清理后，本机 MP4 进入 psychology-video-cleanup 队列，固定给原渲染工人。工人先通过共同 bearer 校验及运行中任务/身份/清理清单检查，再删除成片目录中精确的 renderJobId.mp4；拒绝链接、目录及越界路径，原输出目录可访问且已有可信路径记录时，文件已经不存在也可安全确认；目录不可用不会标记成功。新合成结果保存实际输出路径；旧成片须先在原工人目录找到文件并登记路径，定位不到则报错保留任务，不会因改了配置误报已删除。活动上传任务结束前不删除，失败使用同一个清理任务重试，清理任务连续 15 分钟无更新可重新排队；已确认删除但完成回执丢失时自动补齐完成状态。恢复只作用于清理任务；离线则等待原工人上线。正常新工人和二创辅助工人支持此类型；旧运行工人不会因部署重启，也不会领取不支持的清理类型。

历史已发布版本从迁移时间重新计算 24 小时保留期。旧规划与现有运行任务不因清理功能恢复、重排或中断。部署本功能启用云端五分钟维护，不启动任何新的常驻本机进程。
## 手动发布入口（2026-10-09）

心理学自动发布的两个新建入口均为独立页面：

- `/psychology-publish?create=one`：默认选择“视频爆款 · 二创成片”，逐条预览、勾选后带入保存的 caption（为空时用 title）。已选清单可播放、编辑发布文案、移除、指定账号和 AI 标识；设置项目与时间后手动确认。每批 1–20 条。
- `/psychology-publish?create=normal`：选题来源选择“视频爆款 · 二创成片”，设置数量、抽取方式、关键词、账号与排期，确认后直接抽取成片发布。保留原有模板题库与图文来源。

可用范围：当前用户拥有、未结束来源、已启用、未提交、未清理的二创版本。直接传入成片须上传完成；图片版本须已有与当前来源/版本一致的合成结果。TikTok One 勾选需要云端可播放视频；本机合成成片可先“准备云端预览”。普通抽取会复用本机已合成的视频并固定原工人，不重新生成。

普通任务的统一 API 也支持：

```json
{"module":"psychology","action":"publish.create","requestId":"GENERATE_A_UUID","params":{"body":{"name":"二创成片普通发布","mediaType":"video","sourceType":"video-hits","template":"selected-video","count":2,"connectionIds":["ACCOUNT_ID"],"scheduleAt":1900000000,"intervalMinutes":60,"selection":"recent","query":"","isAiGenerated":true}}}
```

其中 selection 为 random / popular / recent，query 搜索二创标题、原视频标题或发布文案。scheduleAt 是未来 5 分钟至 14 天内的秒级时间戳；全部排期也须在 14 天内。需要心理学发布与视频爆款权限。数量不足整批拒绝，同文件不同上传身份也不会多抽；不支持 allowPeerReuse:true。普通发布无需 tiktokOne；有项目时沿用项目资格校验。

选片接口 `/api/psychology-video-publish` 的 items 在 assetId、connectionId、caption、scheduleAt、isAiGenerated 外支持 `videoHit:{sourceId,version,revision}`。界面自动携带此身份；服务端核对当前版本对应资产，原子占用版本与文件摘要。这个入口、新建普通任务与原 videoHits.publish 共用防重记录、回执和确认发布后 24 小时清理。失败只重试原任务。选片批次配置保存文案摘要用于幂等，正文仅存可清理的任务载荷，不额外永久复制二创文案。

## 手动批量图文发布

已通过 API 写入、补齐并启用的 frames 二创版本，可以在心理学自动发布 → 新建普通发布任务 → 图文 → 视频爆款 · 二创图文中勾选。每个版本 1–35 张图片，保留帧序、已保存标题和发布文案；超过 35 张不可选择。标题使用前 90 个字符，文案为空时使用标题。此入口直接发布图文，无需合成视频或重新生成图片；PNG 仅转换为发布端支持的 JPEG。

列表每页 12 条，支持全选本页和跨页保留，单批最多 100 条；内容按所选账号轮流分配。图文与视频共用同一个版本防重身份，一个版本只提交发布一次，失败时重试原任务。官方确认成功满 24 小时后按现有规则清理二创素材与任务副本；共享原图继续保留。此入口使用已登录页面与现有账号权限，API 导入本身不会发布。
