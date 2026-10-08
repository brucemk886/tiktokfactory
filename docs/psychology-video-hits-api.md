# 心理学视频爆款 API

页面：`https://factory.tiktokaitool.com/psychology-video-hits`。在页面点“API 写入”可复制 GPT / Dot 完整指令。使用“统一 API”现有项目密钥，不需要新增专用密钥。

页面流程：视频列表点击“查看二创”进入独立二创列表，按版本编号列出该视频的全部二创；点击“查看详情”进入原文案 / 二创文案与逐帧原图 / 二创图对照。支持直接打开、刷新和返回。点击图片或右下角放大镜可放大、缩小或查看原始尺寸；“修改原图 / 修改二创图”用于手动替换图片或修改该帧文字、时长，不会自动生成图片。

## 调用入口

- JSON：`POST https://factory.tiktokaitool.com/api/v1/factory`
- 请求头：`Authorization: Bearer <PROJECT_API_KEY>`、`Content-Type: application/json`
- 目录：`GET /api/v1/factory?module=psychology`，查看 `videoHits.*`。
- 每次写操作的外层 `requestId` 是 UUID。重试沿用原编号。更新前读取最新 `revision`。
- HTTP 409 REQUEST_IN_PROGRESS / 503 RESULT_UNKNOWN 时使用 `psychology/requests.get` 查询原请求，不换 UUID 重复提交。

## 来源与版本

`videoHits.create` 保存 `externalId`、TikTok `videoUrl`、`title`、`caption`（发布文案）、`script`（完整视频原文）和 `videoData`（JSON，最多16KB，推荐 playCount/likeCount/commentCount/shareCount/favoriteCount/durationSeconds/accountName/publishedAt）。externalId 在当前账号内唯一；修改使用返回的 id 和 revision。

`videoHits.list` 支持 page/q/sort（recent 或 plays）；每页20条。`videoHits.get` 返回来源、最新revision和版本。`videoHits.update` 按revision修改来源。

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

上传图片及预览视频目前保留，未设自动删除策略。API不会下载或解析原视频；解析和二创由调用端GPT/Dot完成，再把原文、原图和二创资产写入。

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

## 存储与后续清理建议

本次保存的图片和成片在Cloudflare私有R2，元数据、任务身份和防重记录在D1；只传外部imageUrl的图片仍由外部服务保存。自动清理尚未启用，本次不删除历史素材。

建议下一阶段采用确认成功后的引用清理：官方真实发布成功24小时后，将该版本从待发布列表移出，删除不再被其他版本或未结束任务引用的二创图、配音、成片和本地临时文件；原图待该来源全部版本结束或明确归档后才释放。失败或结果未知时保留素材并查询原任务。未绑定的孤立上传可设24小时清理，未发布草稿采用明确到期规则。保留来源、版本、摘要、发布账号、时间、链接和防重标记；清除文件不重置可发布次数。禁止整个目录或R2前缀按固定年龄直接删除，Hub上传文件的保留期需另行按其接口能力管理。
