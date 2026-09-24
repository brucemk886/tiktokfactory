# 心理学同行爆款：grokbot 写入 API

本接口已于 2026-09-11 随同行爆款模块上线。它保存 grokbot 采集的视频与图文数据；不代替采集任务，也不会自动发布内容。

## 开始使用

1. 管理员进入工厂「心理学 → 同行爆款」。
2. 点击页面右上角「写入接口」，再点击「生成 API Key」。完整密钥只在生成时显示，复制到 grokbot 的密钥配置中，不要写入代码仓库或任务日志。
3. 向下面的地址发送 JSON。无需工厂登录 Cookie。

```text
POST https://factory.tiktokaitool.com/api/integrations/psychology/peer-hits
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

密钥仅允许写入本模块；不具备查询列表、管理密钥或发布视频权限。每位管理员可有一个密钥，轮换后旧密钥立即失效。停用密钥、禁用或降级所属管理员账号也会使其失效。模块记录供有权限的管理员共享查看。

## 单条 / 批量请求

可以直接提交一条内容对象，也可以提交数组，推荐批量使用 `{ "items": [...] }`。每次 1–100 条，请求体最多 1 MiB。示例链接仅作格式演示，请替换成实际帖子地址。

```json
{
  "items": [
    {
      "mediaType": "video",
      "voiceGender": "female",
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
| `mediaType` | 内容类型：`video` 或 `photo`。省略时根据 TikTok `/video/`、`/photo/` 路径识别，无法识别时默认 `video`。也接受 `image` / `carousel` 作为 `photo`。 |
| `voiceGender` | 配音性别：`male` 或 `female`，省略时新记录默认 `male`。视频复刻时 `male` 使用男声 `Gubgw9l4dtIoQA9YZHgx`，`female` 使用 Lara `vChnJZ1Cu89g2XXumPfT`。后续更新省略此字段会保留已保存的选择。 |
| `videoUrl` | 必填，完整 HTTP/HTTPS 帖子链接，最多 2000 字符。优先提供展开后的 TikTok 视频或图文地址。字段名为兼容现有客户端继续保留。 |
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
| `videoData` | 其他内容数据的 JSON 对象，序列化后最多 16000 字符；可保存标签、语言、文案、其他指标等。图文复刻可提供完整 `copy`、`caption`、`script`、`transcript` 或 `文案`。若已采集原文，图文可同时提供 `pageTexts`（按图片顺序，最多6项），视频可提供 `transcript` 和可选 `onScreenText`；文案库会直接归档这些字段，避免再次识别。仅有标题或发布文案不视为已完成逐页/逐帧提取。 |

| `rewrites` | 可选，改写版本数组，每条内容最多 10 个、每次请求合计最多 500 个。每项 `{ "title", "caption", "pages": [...], "externalId"? }`：`title` 最多 200 字符，`caption` 必填（简短即可）、最多 2200 字符，`pages` 为 1–6 页、每页 1–1500 字符、第一项是首图。写入前会按下文「写入标准与改写规则」检查，任一版本不合格整批拒收并返回原因。导入即启用，自动挂到这条爆款原文下，可供图文、视频自动发布抽取。`externalId` 可省略：省略时按内容自动生成，同样内容重复提交会被识别为重复；显式传入时，同编号不同内容会被拒绝（版本不可覆盖），该版本记为 `conflicts`，同批其他内容照常写入。 |

数量字段支持非负安全整数，也接受 `"128K"`、`"12.8万"`、`"1.2M"` 等字符串，存储为整数。标准字段优先于别名。时间可用带时区的 ISO 字符串，或 Unix 秒 / 毫秒时间戳；不接受无时区日期、负值和超过服务器时间一天的未来时间。接口列表返回时间统一为 Unix 毫秒，页面显示北京时间。

## 图文：grokbot 一次提交原文与 5 个改写版本

图文生产只需要原文逐页文字和改写版本，推荐 grokbot 每篇图文一次提交全部内容：

```json
{
  "items": [
    {
      "mediaType": "photo",
      "videoUrl": "https://www.tiktok.com/@example/photo/1234567890123456789",
      "title": "Signs you are anxiously attached",
      "playCount": 128000,
      "collectedAt": "2026-09-23T06:00:00Z",
      "source": "grokbot",
      "videoData": {
        "language": "en",
        "caption": "which one is you? #anxiousattachment",
        "pageTexts": ["Signs you are anxiously attached", "You reread their texts looking for hidden meaning"]
      },
      "rewrites": [
        { "title": "When silence feels like rejection", "caption": "Rereading their last message again? You're not too much for wanting clarity. #anxiousattachment #relationships", "pages": ["When silence feels like rejection", "You check your phone before you even open your eyes", "A slow reply is not a verdict on your worth", "Try this: name the fear out loud, then wait an hour before you text"] }
      ]
    }
  ]
}
```

- 附带 `pageTexts`（按图片顺序 1–6 页）的图文，原文在写入时立即完成，返回 `copy: "ready"`，不再调用工厂识图，历史记录同样适用。原帖超过 6 张图时请先整理成 6 页以内再提交，否则工厂会退回自动识图（仅取前 6 张）。已完成的原文不会被后续提交覆盖。
- `title` 建议写原帖首图的钩子句，而不是一串话题标签；话题标签放进 `videoData.caption`。
- 改写版本请去掉原帖的引流页（书单、LINK IN BIO、原作者口头禅），不虚构研究和统计数据，改变表达角度和具体情境，不只替换同义词。
- 处理历史数据：对 `copy` 为 `needs_text` 的链接重新提交一次（附 `pageTexts` 和 `rewrites`）即可，指标字段可省略，已保存的值会保留。`collectedAt` 请省略或填本次处理时间；沿用比已保存记录更早的采集时间会被当作旧数据忽略（`ignored_older`），原文也不会补上。

## 写入标准与改写规则（2026-09-24 起强制）

2026-09-23 导入的 1936 个改写几乎都是程序套模板拼出来的：5 个固定标题句式只换一个话题词，正文每篇一字不差，Checklist 里塞进原文识别乱码，发布文案全空。已全部删除。以下规则由工厂在写入时检查，不达标直接拒收。

### 原文（`videoData.pageTexts`）

- 只提交心理学 / 情感关系题材的英文图文：依恋、分手、暧昧、边界、自我价值等。动漫角色设定、带货、纯段子等跑题内容不要提交。
- `pageTexts` 必须是图片上清晰可读的完整句子，按图片顺序排列，一页一项。识别出乱码（如 `Nou make me the L once WAS`）、残句或大量错字时，请重新识别；仍不清楚就跳过这篇，不要提交。
- 去掉引流页和水印文字（LINK IN BIO、作者名、书单页）。
- 工厂会自动去掉两类页：只有页码、数字或符号的页（没有连续两个字母）；超过 500 字符的长段落页（整页书或文章截图）。其余页按原顺序重新编号，可以只剩首图。全部页都被去掉的帖子，返回 `copy: "skipped"` 并记为失败，不会再调用工厂识图。

### 改写（`rewrites`）

1. **逐篇调用大模型改写，禁止模板和程序拼接。** 先读懂这一篇原帖的钩子、情境和情绪，再写。
2. **每篇 5 个版本，每个版本换一个角度，但都围绕这一篇原帖**：例如换叙述视角（我 / 你 / 旁观者）、换具体场景（发消息、约会后、分手后）、换形式（清单、对比、一句话安慰、可执行小建议）。不同爆款之间不能共用同一句正文。
3. **首图钩子**：5–12 个英文单词，让人一眼觉得「这说的就是我」。写一个具体的瞬间或藏着的感受，用第二人称或 POV，制造好奇或轻轻的「被说中」感。5 个版本的开头方式要各不相同。
4. **中间页写具体的小瞬间，不堆心理学名词**：反复看对方最后一条消息、总是先道歉、偷偷看对方有没有看你的快拍、对方一沉默就开始慌。每页一个意思，句子短，一般不超过 25 个词，一页页推向结尾。
5. **先共情，再给答案**：说出底下那层恐惧（怕自己太多、怕被丢下、怕不被选择），再给一句温暖的真话。口吻像经历过的朋友，不像咨询师或教科书；不说教、不指责。
6. **最后一页要值得收藏或转发**：换个角度看、一句安慰，或一个马上能做的小行动。
7. **发布文案 `caption` 必须写**：简短口语化，引导评论（比如 "which one are you?"、"be honest"），加 2–5 个相关话题标签。页数跟随原帖，单图也可以。
8. **提交前自查**：处在这个处境的人会不会停下来、觉得被说中、想收藏或转发？不会就重写。
9. **不照抄原文句子，不虚构研究数据**，不做诊断（不说 "you have BPD" 之类），不引流、不放链接；全部用英文。

### 工厂自动拒收的情况

| 规则 | 报错示例 |
|---|---|
| `caption` 为空 | caption 不能为空 |
| 图片页或 caption 含链接、link in bio | 包含链接或引流 |
| 图片页与本次提交的原文某页一字不差 | 原样照抄了原文 |
| 拼接痕迹（如 `Do they You track…`） | 有拼接痕迹 |
| 非英文 | 改写必须是英文 |
| 某页（20 字符以上）与其他爆款的改写一字不差，包括本次提交里的其他帖子、库里已有和已删除的版本 | 疑似模板，每篇爆款请单独改写 |

任一版本不合格，整批请求返回 400 并写明「第几条 · 第几个改写 · 第几页 · 原因」，这一批里的原文和其他改写也不会写入。按提示修正后重新提交即可。

### 给 grokbot 的指令（可直接粘贴）

```text
For every psychology photo post, call the language model once per post. Never use templates, fixed sentence patterns, or code that splices sentences together.
1. Read this post's page texts and caption. Skip the post entirely (submit nothing) if it is not about relationships, attachment, breakups, dating or self-worth, or if the page text is garbled or incomplete.
2. Submit videoData.pageTexts as the clean, complete visible text of each image, in order, one item per image (max 6). Remove watermarks, author names and "link in bio" pages. Leave out pages that are only a page number or symbols, and long photographed book/article pages (over 500 characters).
3. Write 5 rewrites. Each keeps this post's core idea and emotional hook but takes a different angle (point of view, concrete scenario, or format such as checklist, contrast, reassurance, one small action). No sentence may be reused across different posts, and no page may copy an original sentence word for word.
4. Write for TikTok photo carousels, where people decide in one second whether to stop:
   - Cover (title and first page): 5-12 words that make the reader feel "this is me". Name a specific moment or hidden feeling, in second person or POV. Create curiosity or a gentle call-out. Vary the hook style across the 5 versions; never reuse the same opening pattern.
   - Middle pages: concrete, relatable micro-moments instead of psychology terms (rereading their last text, apologizing first, checking if they viewed your story, feeling fine until they go quiet). One idea per page, short lines, usually under 25 words, building toward the payoff.
   - Emotion: validate before you advise. Name the fear underneath (being too much, being left, not being chosen), then offer a warm truth. Sound like a friend who has been there, not a therapist or a textbook. No shaming, no preaching.
   - Last page: a payoff worth saving or sending — a reframe, a reassurance, or one small doable step.
   - Caption: short and conversational, invites a reply (a question such as "which one are you?" or "be honest"), plus 2-5 relevant hashtags.
   - Before submitting each version, check: would someone in this situation stop scrolling, feel seen, and want to save or send it? If not, rewrite it.
5. Format: title = the cover hook; pages = 1-6 items following the original post (a single image is fine), cover first; caption is required.
6. English only, no invented statistics, no diagnoses, no links.
7. If the factory rejects a request, read the error (post, rewrite, page, reason), fix only that part and resubmit.
```

## 去重与更新

- 优先按「平台 + 帖子 ID」识别同一内容；没有 ID 时按标准化 URL 识别。TikTok 账号改名、常见追踪参数变化不会重复新增。
- 不会主动展开短链接。短链接和完整链接可能形成不同记录；请 grokbot 使用统一的完整链接，或始终提供一致的 `platform` 和 `videoId`。
- 首次写入新增记录；再次提交同一视频更新已有记录。暂不保留每日历史快照。
- 每条已保存的同行爆款会同步进入独立文案库。重新采集同一帖子只更新同一条记录；不会重复创建文案，也不会因为指标刷新重新调用提取模型。
- 未提供、空文本或为 `null` 的顶层字段保留原值。数量 `0` 会覆盖旧值；较新的播放量降低时也照实保存。
- `videoData` 按 JSON Merge Patch 合并：保留未提交的键；数组整体替换；对象内的 `null` 会删除对应键。
- `collectedAt` 小于已保存记录时，整条输入忽略；时间相同允许幂等重试或补齐数据。更新时请提交本次实际采集到的全部指标。
- 批量请求会先校验所有记录（含 `rewrites` 的格式）；任一记录无效时整批不写入，并返回第几条及具体原因。全部有效后使用数据库事务写入。
- 只保留英语内容。`videoData.language` 为非英语（如 `id` / `th`），或标题/文案主体是印尼语、马来语、菲律宾语、泰语、中文等时，该条 `status` 为 `skipped_non_english`，不影响同批英语记录。标签里的 `#fypシ` 以及标题末尾 grokbot 中文译注不算非英语。

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

每条已保存内容的返回还带：

- `copy`：这条爆款在文案库的原文状态。`ready` 已可用于生产；`extracting` 工厂正在自动识图/识视频；`failed` 自动提取失败；`needs_text` 属于历史记录（2026-09-22 文案库上线前导入的），工厂不会自动提取，需要 grokbot 重新提交这条链接并附上 `videoData.pageTexts`（图文）或 `videoData.transcript`（视频）。
- `copyNote`：需要处理时的原因说明。
- `rewrites`：本条改写版本写入结果 `{ created, duplicates, conflicts }`；顶层 `rewrites` 是整批合计。

`accepted` 是已保存的输入条数（含更新），不是新视频数量；同一批重复提交也分别计数。`ignoredOlder` 表示因采集时间较旧忽略的输入条数，其 `status` 为 `ignored_older`。`skippedNonEnglish` 表示因不是英语跳过的条数。不要对 `ignored_older` 或 `skipped_non_english` 无限重试。

错误格式：`{ "error": "具体原因" }`。

| HTTP 状态 | 处理方式 |
| --- | --- |
| 400 | 参数或某条视频无效，按错误说明修正后重试。 |
| 401 | 密钥缺失、无效、已停用或所属账号不可用。 |
| 405 | 使用 POST；专用密钥不支持读列表。 |
| 413 | 请求超过 1 MiB，拆小批次。 |
| 415 | 设置 `Content-Type: application/json`。 |
| 500 / 网络超时 | 稍后指数退避重试，保留原视频身份和采集时间。 |

页面用「视频爆款 / 图文爆款」两个 Tab 分开读取记录，默认按播放量降序，每页 20 条，可搜索标题、账号名称、用户名和帖子链接，并可逐条修改音色性别。视频复刻按记录选择男声 `Gubgw9l4dtIoQA9YZHgx` 或女性 Lara `vChnJZ1Cu89g2XXumPfT`；图文复刻由官网 DeepSeek V4.1 Flash（`deepseek-flash`）判断每页走文案卡片还是素材库底图，全局最多 10 个任务同时打模型（D1 槽位，租约 4 分钟；排队按任务创建时间先到先得，同批按条目序号，前 1 分钟每 5 秒重排、之后每 20 秒，等满 60 分钟判任务失败，不会挤进主通道；停止轮询的排队者 1 分钟后过期，不会堵住后面的任务。实测并发 11–12 时全部正常，顶到 23 开始大面积不响应），连续失败三次（间隔 10 秒、30 秒）就直接判任务失败并保留上游原话；没有备用模型，DeepSeek 密钥缺失或失效时任务直接失败；原帖图会先下载，HEIC 等模型不认的格式转成 JPEG 后以内嵌字节传给模型，不丢原图，也不再让上游回拉工厂临时地址；需要垫图时封面和详情分两次搜：封面尽量 1:1 对上原图，允许情侣和露脸；详情不再跟随对标画面，固定在海景/云彩/湖面几组明亮方向里按任务种子轮换，同种子还决定取哪一页结果并打乱分配，同一条爆款反复生成不会撞图，取回后按平均色亮度从亮到暗用。叠字保留空格、按词换行；改写时帖子标题/文案和图片叠字分开处理，不调用 Z-Image 和配音。

## 改写中文对照与质量评分（2026-09-24）

继续使用现有 `POST /api/integrations/psychology/peer-hits` 与专用密钥，在每条 `rewrites[]` 中增加：

- `score`：0–100 数字；建议按钩子吸引力 25、情境共鸣 25、表达清晰度 20、改写差异度 20、内容审慎性 10 评分。它是 Grokbot 的文案质量评价，不是实际播放预测。
- `scoreReason`：简短中文评分理由，最多 2000 字符。
- `comparison.original`：原文标题、发布文案及逐页正文每一句的 `{ "text": "完整原语言原句", "zh": "中文翻译" }`。视频改为口播及画面文字逐句。
- `comparison.rewrite`：改写标题、发布文案及逐页正文每一句的 `{ "text": "完整原语言改写句", "zh": "中文翻译", "originalTexts": ["对应的完整原句"] }`。正文可以对应多个原句；新增内容填 `[]`，不能编造原文。

`text` 必须与提交的实际文案一致，不可缩写、改标点或省略后半句。正文按换行和句末标点拆句；标题与发布文案各作为完整一项，不拆句。同样文本重复出现时可复用同一项。正文的 `originalTexts` 只引用原文正文句子，不引用仅出现在标题/发布文案的句子。原文标题、发布文案与改写标题、发布文案按字段直接对应。

示例（一个 rewrites 项）：

```json
{
  "externalId": "anxious-reflection-v1",
  "title": "When messages leave you guessing",
  "caption": "Reading it one more time won't make it clearer. #anxiousattachment #overthinking",
  "pages": ["When messages leave you guessing", "You read the same message again, hoping to feel certain."],
  "score": 91,
  "scoreReason": "钩子清晰，情境具体，表达温和。",
  "comparison": {
    "original": [
      {"text": "Signs you are anxiously attached", "zh": "焦虑型依恋的表现"},
      {"text": "You reread their texts looking for hidden meaning", "zh": "你反复读对方的消息，试图寻找隐藏的含义"}
    ],
    "rewrite": [
      {"text": "When messages leave you guessing", "zh": "当消息让你反复猜测", "originalTexts": ["Signs you are anxiously attached"]},
      {"text": "Reading it one more time won't make it clearer. #anxiousattachment #overthinking", "zh": "再读一遍也不会更清楚。#焦虑型依恋 #想太多", "originalTexts": []},
      {"text": "You read the same message again, hoping to feel certain.", "zh": "你又读了一遍同样的消息，希望能获得确定感。", "originalTexts": ["You reread their texts looking for hidden meaning"]}
    ]
  }
}
```

- 文案库“改写详情”默认按评分降序，同分按创建时间降序；未评分在最后，0 分属于已评分。
- 历史未翻译版本在点击“查看”时调用已授权的 DeepSeek 完成对照与中文翻译，并缓存。Grokbot 提供完整且与原文一致的翻译/对应关系时直接读取，不调用 DeepSeek；缺失或不匹配时首次查看可补全。
- 相同 `externalId`、相同原语言正文的重传允许补充或更新评分、翻译。原语言正文仍不可覆盖，修改正文必须换版本编号。省略评分或翻译不会清空已有值；已删除版本不会被恢复。接口仍将此类补写计入 `duplicates`。
- 原来的请求大小限制不变：每次最多 100 条来源、1 MB；增加翻译后建议缩小每批条数。单个版本的翻译最多 300 项、180000 字符。
- 工厂只接收并展示评分，不会代替 Grokbot 给新版本自动打分，也不改变自动发布的实际流量择优策略。

可直接给 Grokbot 的指令：

> 后续导入心理学爆款时，每个改写版本同时提供 score、scoreReason 和 comparison。按上述 100 分规则独立评分，不为了排序虚报高分。comparison 覆盖原文和改写标题、发布文案以及每一句正文的准确中文翻译，并用 originalTexts 引用对应的完整原句；新增句子用空数组。保留 externalId 和正文，补写同一版本的翻译与评分时不要生成重复版本。
