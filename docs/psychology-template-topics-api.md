# 心理学模板题库：外部读写 API

本接口保存 grokbot 采集或生成的题目到工厂「模板题库」。它不代替页面上的手动新增 / CSV 导入，也不会自动发布。

## 开始使用

1. 管理员进入工厂「心理学 → 模板题库」。
2. 点击页面右上角「读写接口」，再点击「生成 API Key」。完整密钥只在生成时显示，复制到 grokbot 的密钥配置中，不要写入代码仓库或任务日志。
3. 向下面的地址发送 JSON。无需工厂登录 Cookie。此密钥与同行爆款密钥不是同一把。

```text
POST https://factory.tiktokaitool.com/api/integrations/psychology/template-topics
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

现有密钥支持读取全部共享题库、新增及按 ID 修改；不具备删除、管理密钥或发布视频权限。无需重新生成密钥。每位管理员可有一个密钥，轮换后旧密钥立即失效。停用密钥、禁用或降级所属管理员账号也会使其失效。三个模板题库供有权限的管理员共享查看。

## 读取全部题目与单题

```text
GET /api/integrations/psychology/template-topics?template=all&page=1&pageSize=100
GET /api/integrations/psychology/template-topics/TOPIC_ID
Authorization: Bearer YOUR_API_KEY
```

列表返回 `items/total/page/pageSize/totalPages/hasMore/templates/counts`。默认全部模板、全部启用状态，每页20条；`pageSize` 1–100，按 `createdAt` 降序、ID 稳定排序，逐页读取直到 `hasMore=false`。`template` 支持 `all` 或下表三个模板 ID；`enabled` 为 `all/active/inactive`，`query` 搜索题目、内容和分类（最多100字符）。已删除题目不返回。counts 是未删除的各题库总量，不随搜索条件变化。

单题返回 `{ "item": {...} }`，包含 `id/template/title/content/category/priority/enabled/revealComment/replyOptions/choices/image/revision/usageCount/lastUsedAt/createdAt`。四图 choices 按 A/B/C/D 返回图片和文案；单图 image 返回题图。已上传图片的 previewUrl 指向本集成的 `/assets?key=...`，GET 图片时同样携带 Bearer 密钥，不能直接当成免鉴权公开 URL。

## 按 ID 局部修改

```text
PATCH /api/integrations/psychology/template-topics/TOPIC_ID
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

```json
{"revision":1,"revealComment":"新的揭晓评论","replyOptions":{"A":"A 的新回复"},"enabled":true}
```

`TOPIC_ID`、数字 `revision` 使用 GET 返回值。可修改 `title/content/category/priority/enabled/revealComment/replyOptions/choices/imageKey/imageUrl`；省略的字段保持不变。`replyOptions` 可以只提交要改的字母（空字符串清除该回复），`choices` 修改时须提交完整四项。单图只改 choices 时保留题图，只改 imageUrl/imageKey 时保留选项；图片二者互斥，设置其中之一会清除旧的另一个字段。四图图片在对应 choices 中修改。不要同时提交 content 和结构化图片/选项，以免结构化内容覆盖 content。

成功返回 `{ "ok": true, "item": {...} }`，revision 自增。版本缺失或过期返回409；先重新读取并核对冲突，再决定如何修改。题库归属 template、ID、使用量和创建时间只读；未知字段返回400。PATCH 不改变已创建任务的题目快照。POST 仍只新增或跳过重复，不会覆盖现有题目。

## 单条 / 批量请求

可以直接提交一条题目对象，也可以提交数组，推荐批量使用 `{ "items": [...] }`。每次 1–100 条，请求体最多 1 MiB。

```json
{
  "items": [
    {
      "template": "psychology",
      "title": "Which picture did you notice first?",
      "choices": [
        { "copy": "eyes", "imageUrl": "https://images.unsplash.com/photo-1524504388940-b1c1722653e1" },
        { "copy": "hands", "imageUrl": "https://images.unsplash.com/photo-1524502397800-2eeaad7c3fe5" },
        { "copy": "mouth", "imageUrl": "https://images.unsplash.com/photo-1494790108377-be9c29b29330" },
        { "copy": "background", "imageUrl": "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee" }
      ],
      "category": "attention",
      "priority": 80,
      "enabled": true
    },
    {
      "template": "psychology-target-2",
      "title": "What this scene says about your attachment style",
      "imageUrl": "https://images.unsplash.com/photo-1524504388940-b1c1722653e1",
      "choices": [
        { "copy": "stay close" },
        { "copy": "need space" },
        { "copy": "overthink it" },
        { "copy": "walk away" }
      ]
    }
  ]
}
```

同一批可以写进不同模板。如果全部属于同一个模板，也可以把 `template` 放在请求顶层，条目里不再重复：

```json
{
  "template": "psychology-collage",
  "items": [
    { "title": "A quiet thought about leaving", "content": "Story beats and voiceover notes." }
  ]
}
```

## 字段

| 字段 | 含义 / 格式 |
| --- | --- |
| `template` | 必填（条目或请求顶层）。`psychology` = 01 四图测试，`psychology-collage` = 02 纸张拼贴，`psychology-target-2` = 03 单图互动测试。 |
| `title` | 必填，题目 1–200 字符。也接受 `题目`。 |
| `choices` | 01 四图：长度为 4 的数组，按 A/B/C/D。每项 `copy` 1–80 字符，并带 `imageUrl`（https）或页面上传后的 `imageKey`。03 单图互动：同样 4 项，但只填 `copy`，图片用下面的 `imageUrl`/`imageKey`。也接受 `A文案` 至 `D文案`；01 另可 `A图片` 至 `D图片`。 |
| `imageUrl` / `imageKey` / `图片` | 03 单图互动的一张测试图。`imageUrl` 须为 https；页面上传后用 `imageKey`。 |
| `content` | 02 选填，解读 / 脚本，最多 5000 字符。也接受 `内容`。03 也可只交题目，但自动发布需要一张图和四个选项。四图若未传 `choices`，仍可把 `A: 文案 \| https://...` 四行写在这里。 |
| `category` | 选填，最多 60 字符。也接受 `分类`。 |
| `priority` | 0–100 整数，越大越优先抽取；省略为 50。也接受 `优先级`。 |
| `enabled` | 是否允许自动发布抽取。默认启用。可写 `true`/`false`、`1`/`0`、`是`/`否`、`启用`/`停用`。 |

三个题库互不混用：相同题目和内容在不同模板里是两条记录。

## 去重

- 按「模板 + 规范化题目 + 规范化内容」识别同一条。空白折叠后相同则跳过，不覆盖已有解读、优先级或启用状态。
- 需要改解读请在页面编辑；本接口只新增。
- 批量请求会先校验所有记录；任一记录无效时整批不写入，并返回第几条及具体原因。

## 成功与错误

成功返回 HTTP 200：

```json
{
  "accepted": 2,
  "created": 1,
  "skipped": 1,
  "items": [
    { "id": "topic-...", "template": "psychology", "title": "Which picture did you notice first?", "status": "created" },
    { "id": "topic-...", "template": "psychology", "title": "Which picture did you notice first?", "status": "skipped" }
  ]
}
```

`accepted` 是输入条数；`created` 是新写入；`skipped` 是题库里已有相同题目和内容。不要对 `skipped` 无限重试。

错误格式：`{ "error": "具体原因" }`。

| HTTP 状态 | 处理方式 |
| --- | --- |
| 400 | 参数或某条题目无效，按错误说明修正后重试。 |
| 401 | 密钥缺失、无效、已停用或所属账号不可用。 |
| 405 | 不支持该路径或方法；使用 GET 读取、POST 新增、PATCH 修改。 |
| 413 | 请求超过 1 MiB，拆小批次。 |
| 415 | 设置 `Content-Type: application/json`。 |
| 500 / 网络超时 | 稍后指数退避重试，题目身份保持不变即可幂等写入。 |


## 定时揭晓评论

新增可选字段 `revealComment`（CSV 中文列名「揭晓评论」），最多 2000 字符。它独立于 content，不作为生成脚本。开启模板定时评论后，每道被抽中的题都必须填写该字段，否则整批创建会被拒绝。模板延迟默认 120 分钟，可在心理学「定时评论」页面设置，并可配置发布文案末尾的关注引导语。

已创建批次固定使用当时的答案与延迟；修改题目或停用模板不追溯修改旧任务。相同题目/内容的重复导入仍跳过，修改既有答案请使用编辑功能。

## AI 素材引用

`topics.import` 的 item 和 `topics.update` 的 body 均可带 `coverAssetId`、`imageAssetIds`。素材 ID 为 `asset-UUID`，最多关联6张（含封面），须属于 API Key 对应管理员且状态为 ready。单图互动模板设置 coverAssetId 时会自动填写题图的 R2 imageKey，保留四个选项；拼贴模板存为题库封面附件，不修改拼贴视频渲染逻辑。

读取同时返回 `coverAsset`、`imageAssets`：ID、mimeType、尺寸、字节数、SHA256、模型和私有预览地址。该素材 URL 需网页登录工厂；单图原有 image.previewUrl 的 Bearer 集成读取仍可用。旧题目未关联素材时 ID 为空，原有图片字段继续兼容。PATCH 仍须 revision，省略素材字段则保持原引用。MCP 生图入库的配置、写授权与恢复见 [FACTORY_MCP.md](FACTORY_MCP.md)。
