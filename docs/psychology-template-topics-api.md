# 心理学模板题库：grokbot 写入 API

本接口保存 grokbot 采集或生成的题目到工厂「模板题库」。它不代替页面上的手动新增 / CSV 导入，也不会自动发布。

## 开始使用

1. 管理员进入工厂「心理学 → 模板题库」。
2. 点击页面右上角「写入接口」，再点击「生成 API Key」。完整密钥只在生成时显示，复制到 grokbot 的密钥配置中，不要写入代码仓库或任务日志。
3. 向下面的地址发送 JSON。无需工厂登录 Cookie。此密钥与同行爆款密钥不是同一把。

```text
POST https://factory.tiktokaitool.com/api/integrations/psychology/template-topics
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

密钥仅允许写入本模块；不具备查询列表、管理密钥或发布视频权限。每位管理员可有一个密钥，轮换后旧密钥立即失效。停用密钥、禁用或降级所属管理员账号也会使其失效。三个模板题库供有权限的管理员共享查看。

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
| 405 | 使用 POST；专用密钥不支持读列表。 |
| 413 | 请求超过 1 MiB，拆小批次。 |
| 415 | 设置 `Content-Type: application/json`。 |
| 500 / 网络超时 | 稍后指数退避重试，题目身份保持不变即可幂等写入。 |
