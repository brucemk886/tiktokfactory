# 心理学视频爆款：直接 API 写入文档

## 创建用户与管理员权限

具有视频爆款模块权限的管理员可以查看和管理所有成员导入的原选题、二创及关联图片/成片；普通用户只可管理自己创建的选题。列表和详情返回 `ownerId`、`ownerUsername`（创建用户），与调用方填写的 `importSource`（导入来源）分别展示。管理员编辑不会转移原选题或素材的归属。

管理员发布成员素材时，任务与发布账号权限归实际操作的管理员；仍需心理学发布权限、账号分组、粉丝门槛、项目加入及现有防重检查。创建用户无发布权限也可供管理员审核后使用。新建仍归实际创建用户，externalId 仍在该用户内唯一；管理员查重时也须核对 ownerId，明确是为已有选题追加版本还是新建自己的来源。

## 通过页面导入二创图文（无需 API Key）

HTTP 或 MCP 不可用的智能体，可在已登录的工厂浏览器打开 https://factory.tiktokaitool.com/psychology-video-hits/import 。视频爆款列表的“新增二创导入”也会进入此页。

1. 新建原选题时必填原 TikTok 链接、原标题、原发布文案和导入来源（默认为 gpt-dot，可填 grokbot 或其他智能体名）。原发布文案是整条内容的发布说明，不替代逐图文案。
2. 上传 1–15 张原图，每张卡片必须填写这张原图对应的文案。原图与对应文案作为一组保存：第 1 张原图 → 第 1 张文案，以此类推；移动或移除图片时，对应文案一起处理。缺少原标题、原发布文案、原图或任何一张原图的对应文案，都不能完成导入。已有选题会读取全部原图并检查同样的条件，页面展示已存图文；缺项请打开原选题补充后重试。
3. 必填二创标题、二创发布文案，再批量上传二创图片，也可在二创图片区粘贴剪贴板图片或逐行添加公开 HTTPS 图片链接。每套 1–15 张，PNG/JPEG/WebP，每张最多 8 MiB。用上移/下移调整顺序，可逐张填写二创图片文字；来源编号、完整原文和配音文案仍可选填。
4. 点击“保存二创图文”，等待“导入完成”。系统回读核对原标题、原发布文案、每张原图与对应文案，以及二创版本、图片数量、顺序和文案；记录链接可直接打开，或为同一选题继续导入下一版本。
5. 导入保存为停用的 frames 版本，不会启用、合成或发布。原有启用完整性检查保持不变，待人工补充、检查后在详情中处理。无需输入或复制长期密钥。
6. 上传/请求失败时保留当前页面，点击“重试保存并核对”；当前导入复用上传编号和写入 requestId，已成功步骤不重复创建。关闭/刷新前应先核对已经保存的记录；浏览器刷新不会保留本地文件选择。

下面的 HTTP/MCP 接入继续可用，已有 Grokbot 导入不受影响。


版本：2026-10-09 · REST 直接导入版（含 importSource）。

公开文档：https://factory.tiktokaitool.com/docs/psychology-video-hits-api.md

查看结果：https://factory.tiktokaitool.com/psychology-video-hits

## 交给 GPT Dot / grokbot / 其他智能体的执行任务

**本次按 grokbot 的方式直接发送 HTTP API 请求。使用用户授权的项目 API Key，不需要 MCP 工具、刷新连接、OAuth 重新授权或浏览器登录。附录中的 MCP 仅供其他已有连接兼容参考，不作为本次前置条件。**

你要把用户提供的一条真实心理学图文及二创素材导入 Local Factory 的“心理学 → 视频爆款”。先完成一条，读回确认后停止。不要批量试错或创建占位垃圾数据。

1. 使用当前环境的 HTTP 请求工具或代码执行工具，例如 Python、Node.js 或 curl。凭据使用用户为本任务授权的项目密钥；下文以环境变量 `FACTORY_API_KEY` 为例。不要回显密钥或把它写入素材/请求日志。这里沿用现有项目密钥，不要求重置或轮换。
2. 若当前会话没有任何 HTTP/代码执行能力，明确报告“本会话缺少直接 HTTP 执行工具，尚未发送请求”。若没有可用密钥，说明缺少密钥配置。不要把未执行请求解释为服务端没有写入权限，也不要要求用户刷新 MCP。
3. 先只读查询目录及现有来源，确认连接有效，再执行下面的一条图文流程。新来源使用 `importSource:"gpt-dot"`；grokbot 使用 `grokbot`，其他智能体使用自己的稳定名称。
4. 使用实际 TikTok 链接、文案、图片字节和已知数据；未知播放量等字段省略，不伪造。来源 `externalId` 稳定且唯一，同一原视频先查询确认是否已存在。不要改写其他智能体导入的记录。
5. 保存每步请求的 UUID、参数和返回 ID/revision；失败/断线后先查询状态，重试相同请求使用原 UUID 和原请求体。已有 Grokbot 请求保持原输入，不给正在重试的旧请求补字段或换编号。
6. 本次仅保存素材，二创保持 `enabled:false`，不调用合成、发布、归档或自动运营。最后返回来源 ID、二创编号、原图/二创图数量、导入来源、页面链接和真实失败原因。

## 认证和只读连通检查

项目密钥在工厂的“统一 API”页面管理： https://factory.tiktokaitool.com/factory-api 。密钥所属用户需要“心理学视频爆款”模块权限。API 调用用请求头认证，不使用网页登录 Cookie。

```http
Authorization: Bearer <PROJECT_API_KEY>
```

先发：

```http
GET https://factory.tiktokaitool.com/api/v1/factory?module=psychology&action=videoHits.create
Authorization: Bearer <PROJECT_API_KEY>
```

确认目录中有 `videoHits.create`。然后查询来源列表：所有 action 都通过下列统一 POST 入口调用，读取 action 无需 requestId。

```http
POST https://factory.tiktokaitool.com/api/v1/factory
Authorization: Bearer <PROJECT_API_KEY>
Content-Type: application/json
```

```json
{"module":"psychology","action":"videoHits.list","params":{"query":{"page":1,"q":"实际视频ID","scope":"all","sort":"recent"}}}
```

`q` 是模糊搜索，必须检查返回条目的 `externalId` 或 `videoUrl`，并按 `total/hasMore` 翻页；不能只查第一页就断言不存在。`importSource` 不参与查重身份；`externalId` 在密钥所属用户内唯一。

### HTTP 执行示例（Python 标准库）

这段代码只提供请求函数并执行只读目录检查。后续把下文 JSON 保存为文件，再传给 `send`；不要在日志中打印请求头。`HTTPError` 中会保留真实状态和响应体，异常消息勿额外拼接密钥。

```python
import json
import os
import urllib.request
import urllib.error

BASE = "https://factory.tiktokaitool.com"
KEY = os.environ["FACTORY_API_KEY"]

def send(path, method="GET", payload=None, binary=None, content_type=None):
    if payload is not None and binary is not None:
        raise ValueError("JSON 和二进制只能选一种")
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else binary
    headers = {"Authorization": "Bearer " + KEY}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    elif content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    text = raw.decode("utf-8")
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        result = {"responseText": text}
    return status, result

status, result = send("/api/v1/factory?module=psychology&action=videoHits.create")
print(status, result)  # 目录/业务结果，不含请求头

# 单步 JSON 调用：先将替换占位符后的请求保存到文件，包含固定 requestId。
# with open("step-create.json", encoding="utf-8") as file:
#     status, result = send("/api/v1/factory", "POST", payload=json.load(file))
# print(status, result)
# 仅当本步成功且读回核对后，才执行依赖它的下一步。
```

## 一条图文的完整写入流程

下面 `GENERATE_UUID_*`、`SOURCE_ID`、图片 UUID、视频 ID 和文案都需要替换为实际值。UUID 可使用 Python `str(uuid.uuid4())` 或 Node.js `crypto.randomUUID()` 生成，**先保存再发送**。编号是步骤编号，不是 revision。

### 1. 创建原视频来源

```json
{
  "module":"psychology",
  "action":"videoHits.create",
  "requestId":"GENERATE_UUID_CREATE",
  "params":{"body":{
    "externalId":"tiktok-REAL_VIDEO_ID",
    "importSource":"gpt-dot",
    "videoUrl":"https://www.tiktok.com/@REAL_ACCOUNT/video/REAL_VIDEO_ID",
    "title":"实际原视频标题",
    "caption":"实际原发布文案",
    "script":"实际原视频完整文字",
    "videoData":{}
  }}
}
```

成功返回 `{ "ok":true, "id":"vh-...", "revision":1 }`。记住 `id`；不要把 TikTok 视频 ID 当作此来源 ID。已存在的来源先核对所有权/导入来源和已有版本，复用真实 ID，不再次 create，也不覆盖原数据。

### 2. 上传实际原图

每张图片生成并保存独立的上传 UUID；图片请求不经过统一 JSON action。

```http
PUT https://factory.tiktokaitool.com/api/integrations/psychology/video-hits/assets/ORIGINAL_UPLOAD_UUID
Authorization: Bearer <PROJECT_API_KEY>
Content-Type: image/png

<实际图片的二进制字节>
```

Python 示例，复用上面的 `send`：

```python
from pathlib import Path
# upload_id 必须事先生成并保存；重试沿用它。
upload_id = "REPLACE_WITH_SAVED_UPLOAD_UUID"
status, result = send(
    "/api/integrations/psychology/video-hits/assets/" + upload_id,
    "PUT", binary=Path("original.png").read_bytes(), content_type="image/png"
)
print(status, result)
```

第一次成功通常是 HTTP 201，原编号同字节重试是 HTTP 200；返回 `assetId`。上传后 GET 同一地址，必须确认 `status:"active"`。PNG/JPEG/WebP，每张最多 8MiB，Content-Type 必须与实际文件一致。上传正文不是 JSON、base64 或 multipart/form-data。

### 3. 绑定原图（version 为字符串 "0"）

```json
{
  "module":"psychology","action":"videoHits.frames.write",
  "requestId":"GENERATE_UUID_ORIGINAL_FRAMES",
  "params":{"id":"SOURCE_ID","version":"0","body":{
    "revision":1,
    "frames":[{"index":1,"assetId":"ORIGINAL_UPLOAD_UUID","text":"原图实际画面文字","durationSeconds":3}]
  }}
}
```

这里 revision=1 仅适用于刚创建且无人修改的来源。成功后来源 revision 递增，后续读取实际返回值。多张原图逐张上传，再按帧号写入同一 version=0（每次最多100帧）。

### 4. 新建一套二创文案（version 为字符串 "1"）

```json
{
  "module":"psychology","action":"videoHits.versions.write",
  "requestId":"GENERATE_UUID_VERSION",
  "params":{"id":"SOURCE_ID","version":"1","body":{
    "revision":0,
    "inputMode":"frames",
    "name":"二创版本 1",
    "title":"实际二创标题",
    "caption":"实际二创发布文案",
    "script":"实际二创完整文字或配音文案",
    "enabled":false
  }}
}
```

仅未创建的新版本使用 revision=0；成功返回该版本 revision=1。来源 revision 与二创版本 revision 是两个独立值，不能混用。已有版本必须先读取再决定是否编辑，不盲目复用编号1覆盖。

### 5. 上传并绑定二创图

使用新的 `REMIX_UPLOAD_UUID` 按步骤2上传真实二创图片，GET 确认 active。随后：

```json
{
  "module":"psychology","action":"videoHits.frames.write",
  "requestId":"GENERATE_UUID_REMIX_FRAMES",
  "params":{"id":"SOURCE_ID","version":"1","body":{
    "revision":1,
    "frames":[{"index":1,"assetId":"REMIX_UPLOAD_UUID","text":"二创图实际画面文字","durationSeconds":3}]
  }}
}
```

原图与二创图分别上传，不用同一上传 UUID 存不同图片。对每张真实图片重复，帧号从1连续、原图与二创图对应。本次保持停用，后续经用户确认再启用。若目标是普通图文发布，每套二创准备1–15张图片。

### 6. 读回并交付

依次 POST 下列独立 JSON（读取不传 requestId）：

```json
{"module":"psychology","action":"videoHits.get","params":{"id":"SOURCE_ID"}}
```

```json
{"module":"psychology","action":"videoHits.versions.get","params":{"id":"SOURCE_ID","version":"1"}}
```

```json
{"module":"psychology","action":"videoHits.frames.list","params":{"id":"SOURCE_ID","version":"0","query":{"page":1}}}
```

```json
{"module":"psychology","action":"videoHits.frames.list","params":{"id":"SOURCE_ID","version":"1","query":{"page":1}}}
```

核对 `source.importSource === "gpt-dot"`、标题/文案、二创 `inputMode === "frames"`、`enabled === false`、原图/二创帧号与 assetId；有后续页必须继续读。图片可通过同一 Bearer 请求 `GET /api/integrations/psychology/video-hits/assets/UPLOAD_UUID/file` 读取实际文件核对；不要把响应中的需登录页面预览链接当公开图片地址。

最终回复：

- 实际来源 ID、externalId、导入来源、二创版本编号；
- 原图与二创图数量、保存后的 revision、启用状态；
- 页面链接 `https://factory.tiktokaitool.com/psychology-video-hits/detail?id=SOURCE_ID&version=1`；
- 每步成功状态或失败的 HTTP 状态/error/code/requestId；不包含密钥。

## 失败处理与防重复

| 情况 | 处理 |
|---|---|
| 无 HTTP/代码执行工具 | 明确尚未发送请求；这是客户端执行能力缺失，不是服务端拒绝 |
| 401 | 检查 Bearer 密钥是否正确、启用；不要改原任务编号 |
| 403 / 目录没有 videoHits | 检查密钥所属用户的管理员身份与心理学视频爆款模块权限；REST 不需要 OAuth scope |
| 400 | 阅读 error，修正字段/类型；修改后的请求用新 requestId |
| 409 revision 冲突 | 先 GET 最新数据，核对他人修改；需要新更新时使用最新 revision 和新 requestId |
| 409 同编号不同参数 | 找回原请求体；同 requestId 只能重试同一操作、同一参数 |
| 409 REQUEST_IN_PROGRESS / 503 RESULT_UNKNOWN / 网络断线 | 用原 requestId 查询 requests.get，并读回业务记录；不换 UUID 重发，不假定失败 |
| 图片上传中断 | GET 原 uploadId 查状态，active 复用；uploading 或404可用原编号同字节重传；不同文件用新 UUID |
| 410 图片已清理 | 原编号不可再用；需要重新导入时使用新上传 UUID |
| 单条失败 | 停止依赖该步的写入，报告实际错误；不把部分成功说成全部成功 |

请求回执查询：

```json
{"module":"psychology","action":"requests.get","params":{"id":"ORIGINAL_REQUEST_UUID"}}
```

检查 `state`、`status`、`result`；`state:"done"` 表示回执已保存，仍须检查其中业务 HTTP 状态和结果。processing/未知不得当作可以丢弃的旧请求。若返回404，先核对来源/版本和原请求是否真正到达，再决定用**原编号原参数**重试。

以下为全部 API 字段与后续功能参考；本次试写止于上面的素材保存及读回。

## 调用入口

- JSON：`POST https://factory.tiktokaitool.com/api/v1/factory`
- 请求头：`Authorization: Bearer <PROJECT_API_KEY>`、`Content-Type: application/json`
- 目录：`GET /api/v1/factory?module=psychology`，查看 `videoHits.*`。
- 每次写操作的外层 `requestId` 是 UUID。重试沿用原编号。更新前读取最新 `revision`。
- HTTP 409 REQUEST_IN_PROGRESS / 503 RESULT_UNKNOWN 时使用 `psychology/requests.get` 查询原请求，不换 UUID 重复提交。

## 来源与版本

`videoHits.create` 保存 `importSource`、`externalId`、TikTok `videoUrl`、`title`、`caption`（发布文案）、`script`（完整视频原文）和 `videoData`（JSON，最多16KB，推荐 playCount/likeCount/commentCount/shareCount/favoriteCount/durationSeconds/accountName/publishedAt）。externalId 在当前账号内唯一；修改使用返回的 id 和 revision。

`videoHits.list` 支持 page/q/sort（recent 或 plays）、scope（active/archived/all）及 inputMode（all/video/frames，默认 all）；每页20条。inputMode 放在 params.query 中：video 筛选含视频二创的来源，frames 筛选含图文二创的来源，筛选在分页前执行。同一来源可同时包含两种二创，不会重复返回。每条来源附带 videoVersionCount、frameVersionCount 和总 versionCount。`videoHits.get` 返回来源、最新revision和版本。`videoHits.update` 按revision修改来源。

每个来源最多同时保留20个未清理二创版本，已清理历史不占名额。原选题、原文与原图长期保留。版本编号为1–2147483647且不复用：读取 `videoHits.get` 返回的 `nextVersion` 新建；`activeVersionCount` 是在库数，`maxActiveVersions=20`。用 `videoHits.versions.write` 创建/编辑。新版本 revision=0；后续读 `videoHits.versions.get` 取最新revision。字段为 name/title/caption/script/enabled。新版本默认停用，文案和图片补齐后提交 enabled=true。

### 导入来源 importSource

- 来源列表和详情返回 `importSource`，页面单独显示“导入来源”并支持筛选。它表示由哪个智能体导入，与原视频作者、视频/图文类型和来源状态分开。
- 创建/修改放在 `params.body.importSource`；筛选放在 `params.query.importSource`，精确匹配，空值/不填表示全部，先筛选再分页，可与类型/状态一起使用。
- 去除首尾空格、转小写，1–64 位，格式 `^[a-z0-9][a-z0-9._-]{0,63}$`。推荐 `grokbot` / `gpt-dot`；未来智能体可直接用新名称，无需改接口。页面手工新增默认 `manual`。
- 用户已确认旧记录全部来自 grokbot，迁移统一补为 `grokbot`，不修改旧 revision、时间或回执。为兼容仍在运行的旧导入，创建时不传也默认 `grokbot`；更新时不传保留原值。新调用方请显式传入真实名称，不能把默认值当身份识别。
- 此字段是调用方填写的来源标记，不是已验证身份或权限凭据；普通用户按创建用户隔离；有模块权限的管理员可管理所有成员来源，OAuth/API 仍需原有认证与授权。
- 例：列出 Dot 导入：`{"module":"psychology","action":"videoHits.list","params":{"query":{"importSource":"gpt-dot","page":1}}}`；修正标签用 `videoHits.update`，传真实 `id`、最新 `revision`、`importSource` 和新 `requestId`。

## 图片上传

推荐把实际图片字节上传到私有R2，避免临时外链过期：

```http
PUT /api/integrations/psychology/video-hits/assets/GENERATE_UPLOAD_UUID
Authorization: Bearer <PROJECT_API_KEY>
Content-Type: image/png

<实际 PNG 文件的二进制字节>
```

支持PNG/JPEG/WebP，每张最多8MB。返回assetId。同一上传UUID只能写相同字节和类型，冲突返回409。私有预览按当前所有者权限读取，不对匿名用户开放。

REST 统一 JSON 接口不接收图片二进制/base64，也不把 sandbox: 文件路径当图片链接。调用端需要读取真实文件后上传；不能读取时，可使用持久公开HTTPS域名图片链接。图片链接不允许本机、私网IP、凭据或自定义端口；下载时验证解析和重定向地址。

## 逐帧写入

`version:"0"` 表示原图；正整数字符串（如 `"1"`、`"21"`）表示对应二创版本。每套最多300个分镜帧，index从1连续编号，每次写1–100帧，可分批补充。这是场景/分镜图片序列；成片由FFmpeg输出30fps，不要求上传每个编码视频帧。

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

新的显式合成/发布API不会启动或恢复旧心理学自动规划。GPT/Dot只在其当前任务已获发布授权时调用publish；只有素材写入授权时结束于素材保存或按需启用；render 另需明确合成授权。

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

原选题、原文和原图长期保留，供后续持续二创。全部已创建版本确认发布后，可在页面点击“归档来源”或调用 videoHits.archive；归档会冻结新增/修改并从默认列表隐藏，但不会清除原素材。在“已归档”筛选进入来源后点击“恢复二创”，或调用 videoHits.restore，即可继续新增版本。已发布版本的身份与记录保留，不能覆盖或再次发布。

```json
{"module":"psychology","action":"videoHits.archive","requestId":"GENERATE_A_UUID","params":{"id":"SOURCE_ID","body":{"revision":SOURCE_REVISION}}}
```

videoHits.cleanup / GET /api/psychology-video-hits/cleanup 返回 policy（含 localStaleMinutes:15）、versions、images、videos、previews、local 和至多十条待重试错误（含本机清理失败）。versions.cleaned 表示文案及素材引用已清理，实际 R2 与本机文件删除分别查看 images/videos/previews/local；共享文件继续保留。页面“清理状态”显示同一信息；来源列表 query.scope 为 active（默认）、archived 或 all。

R2 文件清理先用事务检查所有引用并标记 deleting，阻止并发新绑定，再删除精确对象。失败会保留清单，按最近尝试时间轮转重试，避免少数坏文件挡住整批清理；晚到上传通过清理代次保护和持久补偿清单再次回收，旧删除回执不能覆盖新一轮重试；完成后标记 deleted，保留不可复用的上传身份及原存储键，私有预览返回 410。不按整目录或整个 R2 前缀删除。

合成结束或失败后立即清除该任务专属的分镜下载、配音、字幕和临时图片；外部输入音频不删除。发布确认并完成版本清理后，本机 MP4 进入 psychology-video-cleanup 队列，固定给原渲染工人。工人先通过共同 bearer 校验及运行中任务/身份/清理清单检查，再删除成片目录中精确的 renderJobId.mp4；拒绝链接、目录及越界路径，原输出目录可访问且已有可信路径记录时，文件已经不存在也可安全确认；目录不可用不会标记成功。新合成结果保存实际输出路径；旧成片须先在原工人目录找到文件并登记路径，定位不到则报错保留任务，不会因改了配置误报已删除。活动上传任务结束前不删除，失败使用同一个清理任务重试，清理任务连续 15 分钟无更新可重新排队；已确认删除但完成回执丢失时自动补齐完成状态。恢复只作用于清理任务；离线则等待原工人上线。正常新工人和二创辅助工人支持此类型；旧运行工人不会因部署重启，也不会领取不支持的清理类型。

历史已发布版本从迁移时间重新计算 24 小时保留期。旧规划与现有运行任务不因清理功能恢复、重排或中断。部署本功能启用云端五分钟维护，不启动任何新的常驻本机进程。
## 手动发布入口（2026-10-09）

心理学自动发布的两个新建入口均为独立页面：

- `/psychology-publish?create=one`：默认选择“视频爆款 · 二创成片”，预览并批量勾选后带入保存的 caption（为空时用 title），再选择账号、项目与时间并点击发布。视频随机均衡分配给所选账号，同一账号按间隔排期，批次统一设置 AI 标识，无需逐条二次核验。每批 1–20 条。
- `/psychology-publish?create=normal`：选题来源选择“视频爆款 · 二创成片”，设置数量、抽取方式、关键词、账号与排期，确认后直接抽取成片发布。保留原有模板题库与图文来源。

可用范围：当前用户拥有、未归档来源、已启用、未提交、未清理的二创版本。直接传入成片须上传完成；图片版本须已有与当前来源/版本一致的合成结果。TikTok One 勾选需要云端可播放视频；本机合成成片可先“准备云端预览”。普通抽取会复用本机已合成的视频并固定原工人，不重新生成。

普通任务的统一 API 也支持：

```json
{"module":"psychology","action":"publish.create","requestId":"GENERATE_A_UUID","params":{"body":{"name":"二创成片普通发布","mediaType":"video","sourceType":"video-hits","template":"selected-video","count":2,"connectionIds":["ACCOUNT_ID"],"scheduleAt":1900000000,"intervalMinutes":60,"selection":"recent","query":"","isAiGenerated":true}}}
```

其中 selection 为 random / popular / recent，query 搜索二创标题、原视频标题或发布文案。scheduleAt 是未来 5 分钟至 14 天内的秒级时间戳；全部排期也须在 14 天内。需要心理学发布与视频爆款权限。数量不足整批拒绝，同文件不同上传身份也不会多抽；不支持 allowPeerReuse:true。普通发布无需 tiktokOne；有项目时沿用项目资格校验。

选片接口 `/api/psychology-video-publish` 的 items 在 assetId、connectionId、caption、scheduleAt、isAiGenerated 外支持 `videoHit:{sourceId,version,revision}`。界面自动携带此身份；服务端核对当前版本对应资产，原子占用版本与文件摘要。这个入口、新建普通任务与原 videoHits.publish 共用防重记录、回执和确认发布后 24 小时清理。失败只重试原任务。选片批次配置保存文案摘要用于幂等，正文仅存可清理的任务载荷，不额外永久复制二创文案。

## 手动批量图文发布

已通过 API 写入、补齐并启用的 frames 二创版本，可以在心理学自动发布 → 新建普通发布任务 → 图文 → 视频爆款 · 二创图文中勾选。每个版本 1–15 张图片，保留帧序、已保存标题和发布文案；超过 15 张不可选择。标题使用前 90 个字符，文案为空时使用标题。此入口直接发布图文，无需合成视频或重新生成图片；PNG 仅转换为发布端支持的 JPEG。

列表每页 12 条，支持全选本页和跨页保留，单批最多 100 条；内容按所选账号轮流分配。图文与视频共用同一个版本防重身份，一个版本只提交发布一次，失败时重试原任务。官方确认成功满 24 小时后按现有规则清理二创素材与任务副本；共享原图继续保留。此入口使用已登录页面与现有账号权限，API 导入本身不会发布。



## 附录：已有 MCP 连接的兼容参考（直接 API 试写跳过）

本次用户指定直接 HTTP API，执行以上 REST 流程即可；没有 MCP 工具不影响 REST。下面仅保留已有 OAuth 客户端的字段映射。

### 工具与 REST 共用一套数据

工厂管理员须具有“心理学视频爆款”模块权限。读取用 `factory.read`，素材写入额外用 `factory.video_hits.write`；每次调用都检查当前账号权限与连接是否撤销。题库写入 `factory.topics.write` 无法替代视频爆款权限。

下表工具都接收与 REST 相同的 `params` 对象；写入时加同级 `requestId`。MCP 不传 `module/action`，工具名已选定操作。路径 id/version 均是字符串；版本 0 仅用于原图分镜。

| REST action | MCP 工具 | 用途 |
|---|---|---|
| videoHits.list | psychology_videoHits_list | params.query 按页查询来源 |
| videoHits.get | psychology_videoHits_get | params.id 查询来源和版本 |
| videoHits.create | psychology_videoHits_create | params.body 创建来源 |
| videoHits.update | psychology_videoHits_update | params.id/body 按 revision 编辑来源 |
| videoHits.versions.get | psychology_videoHits_versions_get | params.id/version 查询版本 |
| videoHits.versions.write | psychology_videoHits_versions_write | params.id/version/body 创建或编辑版本 |
| videoHits.frames.list | psychology_videoHits_frames_list | params.id/version/query.page 查询分镜 |
| videoHits.frames.write | psychology_videoHits_frames_write | params.id/version/body 写入分镜 |
| videoHits.jobs | psychology_videoHits_jobs | params.id/version 查询已有任务 |
| videoHits.cleanup | psychology_videoHits_cleanup | params:{} 查询清理状态 |
| requests.get | psychology_videoHits_requests_get | MCP 用 {requestId:原UUID}；REST 用 params:{id:原UUID} |

MCP 另外提供：

- `psychology_videoHits_guide({})`：读取本文件，同时返回 writeAuthorized 和可用 action。
- `psychology_videoHits_assets_upload_file({uploadId,image:{file_id,download_url,mime_type?,file_name?}})`：宿主提供的实际 PNG/JPEG/WebP 文件引用，最多 8 MB。不得编造文件 ID / URL。受控下载仅允许已支持的 ChatGPT 附件域名，跨域跳转也检查；临时链接过期时刷新同一附件再重试。
- `psychology_videoHits_assets_upload_bytes({uploadId,contentType,imageBase64})`：代码客户端读取**实际图片文件**后编码为纯 base64，或由上传界面自动编码。最多 8 MB；不能要求模型凭空输出图片字节。不接收 data URL。
- `psychology_videoHits_assets_get({uploadId})`：读取 active/uploading/deleting/deleted、assetId、摘要和大小。只有 active 可绑定。previewUrl 需要工厂登录，不能当持久公开 imageUrl。
- `psychology_videoHits_prepare_image_upload({uploadId})`：宿主无法传附件或读取文件时，打开本地选图界面，选图后确认上传。返回 awaiting_image 尚未保存；上传后用 assets_get 核实 active。

MCP 创建来源示例（调用 `psychology_videoHits_create` 的参数）：

```json
{"requestId":"GENERATE_A_UUID","params":{"body":{"externalId":"tiktok:REAL_VIDEO_ID","importSource":"gpt-dot","videoUrl":"https://www.tiktok.com/@REAL_ACCOUNT/video/REAL_VIDEO_ID","title":"来源标题","caption":"原发布文案","script":"原视频完整文案","videoData":{"playCount":12000}}}}
```

同一操作的 REST 参数只需加 `module:"psychology", action:"videoHits.create"`。两种入口共用所有权、revision、requestId 防重与回执，不能切换入口来绕过重复请求保护。

### 持续二创与原选题保留

发布成功满24小时后仅清理该二创的文案、图片和成片，保留轻量发布记录、防重身份；草稿、排队中、失败和未确认成功的版本不自动清理。原选题、原文和version=0原图长期保留。清理后可用nextVersion继续二创，不要覆盖已发布编号或重传同一个已发布成片。

`videoHits.archive` 仅将来源移到已归档，保留原素材。`videoHits.restore`（params.id、body.revision及新的requestId）恢复到进行中；这两个操作仅在界面/REST可用，MCP素材写入不开放归档或恢复。历史已删除的原文件无法恢复，需要重新补充。
