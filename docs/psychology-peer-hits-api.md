# 心理学同行爆款：grokbot 写入 API

本接口已于 2026-09-11 随同行爆款模块上线。它保存 grokbot 采集的数据；不代替采集任务，也不会自动发布视频。

## 开始使用

1. 管理员进入工厂「心理学 → 同行爆款」。
2. 展开「grokbot 写入接口」，点击「生成 API Key」。完整密钥只在生成时显示，复制到 grokbot 的密钥配置中，不要写入代码仓库或任务日志。
3. 向下面的地址发送 JSON。无需工厂登录 Cookie。

```text
POST https://factory.tiktokaitool.com/api/integrations/psychology/peer-hits
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

密钥仅允许写入本模块；不具备查询列表、管理密钥或发布视频权限。每位管理员可有一个密钥，轮换后旧密钥立即失效。停用密钥、禁用或降级所属管理员账号也会使其失效。模块记录供有权限的管理员共享查看。

## 单条 / 批量请求

可以直接提交一条视频对象，也可以提交数组，推荐批量使用 `{ "items": [...] }`。每次 1–100 条，请求体最多 1 MiB。示例链接仅作格式演示，请替换成实际视频地址。

```json
{
  "items": [
    {
      "videoUrl": "https://www.tiktok.com/@example/video/1234567890123456789",
      "title": "Which picture did you notice first?",
      "accountName": "Psychology Example",
      "accountUsername": "@example",
      "accountUrl": "https://www.tiktok.com/@example",
      "playCount": 128000,
      "likeCount": 8200,
      "commentCount": 460,
      "favoriteCount": 1800,
      "shareCount": 920,
      "durationSeconds": 18.5,
      "publishedAt": "2026-09-10T10:30:00Z",
      "collectedAt": "2026-09-11T07:30:00Z",
      "source": "grokbot",
      "videoData": {
        "language": "en",
        "hashtags": ["psychology", "test"],
        "hook": "Which picture did you notice first?"
      }
    }
  ]
}
```

建议 grokbot 显式提供 `collectedAt`，重试时沿用原采集时间，避免延迟到达的旧数据覆盖较新数据。未采集到的指标请省略或填 `null`，不要填 `0`；`0` 表示真实的零。

## 字段

| 字段 | 含义 / 格式 |
| --- | --- |
| `videoUrl` | 必填，完整 HTTP/HTTPS 视频链接，最多 2000 字符。优先提供展开后的 TikTok 视频地址。 |
| `videoId` | 可选字符串，最多 100 字符；TikTok 完整链接可自动解析。不接受数字，避免长 ID 精度丢失。与链接中的 ID 不同会报错。 |
| `platform` | 非 TikTok 链接可填平台名称，最多 40 字符，默认取域名；TikTok 域名自动记为 `tiktok`。 |
| `title` | 标题或文案，最多 2000 字符。 |
| `accountName` / `accountUsername` | 账号显示名称 / 用户名，各最多 160 字符。 |
| `accountUrl` / `coverUrl` | 可选账号主页 / 封面 HTTP/HTTPS URL，各最多 2000 字符。只存储地址，不抓取内容。 |
| `playCount` | 播放量，也接受 `views`。 |
| `likeCount` | 点赞量，也接受 `likes`。 |
| `commentCount` | 评论量，也接受 `comments`。 |
| `favoriteCount` | 收藏量，也接受 `favorites` 或 `saves`。 |
| `shareCount` | 分享量，也接受 `shares`。 |
| `durationSeconds` | 时长，0–86400 秒，可含小数。 |
| `publishedAt` | 视频发布时间。 |
| `collectedAt` | 本次采集时间；省略时取接口接收时间。 |
| `source` | 数据来源，例如 `grokbot`，最多 80 字符。 |
| `videoData` | 其他视频数据的 JSON 对象，序列化后最多 16000 字符；可保存标签、语言、描述、其他指标等。 |

数量字段支持非负安全整数，也接受 `"128K"`、`"12.8万"`、`"1.2M"` 等字符串，存储为整数。标准字段优先于别名。时间可用带时区的 ISO 字符串，或 Unix 秒 / 毫秒时间戳；不接受无时区日期、负值和超过服务器时间一天的未来时间。接口列表返回时间统一为 Unix 毫秒，页面显示北京时间。

## 去重与更新

- 优先按「平台 + 视频 ID」识别同一视频；没有 ID 时按标准化 URL 识别。TikTok 账号改名、常见追踪参数变化不会重复新增。
- 不会主动展开短链接。短链接和完整链接可能形成不同记录；请 grokbot 使用统一的完整链接，或始终提供一致的 `platform` 和 `videoId`。
- 首次写入新增记录；再次提交同一视频更新已有记录。暂不保留每日历史快照。
- 未提供、空文本或为 `null` 的顶层字段保留原值。数量 `0` 会覆盖旧值；较新的播放量降低时也照实保存。
- `videoData` 按 JSON Merge Patch 合并：保留未提交的键；数组整体替换；对象内的 `null` 会删除对应键。
- `collectedAt` 小于已保存记录时，整条输入忽略；时间相同允许幂等重试或补齐数据。更新时请提交本次实际采集到的全部指标。
- 批量请求会先校验所有记录；任一记录无效时整批不写入，并返回第几条及具体原因。全部有效后使用数据库事务写入。

## 成功与错误

成功返回 HTTP 200：

```json
{
  "accepted": 1,
  "ignoredOlder": 0,
  "items": [
    {
      "id": "psy-...",
      "videoUrl": "https://www.tiktok.com/@example/video/1234567890123456789",
      "status": "saved"
    }
  ]
}
```

`accepted` 是已保存的输入条数（含更新），不是新视频数量；同一批重复提交也分别计数。`ignoredOlder` 表示因采集时间较旧忽略的输入条数，其 `status` 为 `ignored_older`。不要对 `ignored_older` 无限重试。

错误格式：`{ "error": "具体原因" }`。

| HTTP 状态 | 处理方式 |
| --- | --- |
| 400 | 参数或某条视频无效，按错误说明修正后重试。 |
| 401 | 密钥缺失、无效、已停用或所属账号不可用。 |
| 405 | 使用 POST；专用密钥不支持读列表。 |
| 413 | 请求超过 1 MiB，拆小批次。 |
| 415 | 设置 `Content-Type: application/json`。 |
| 500 / 网络超时 | 稍后指数退避重试，保留原视频身份和采集时间。 |

页面列表默认按播放量降序，每页 20 条，可搜索标题、账号名称、用户名和视频链接，并切换采集 / 发布时间排序。
