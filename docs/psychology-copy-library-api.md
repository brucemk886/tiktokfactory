# 文案库外部读取与修改 API

入口：心理学 → 文案库 → 右上角「读写接口」→「复制文案读取与修改说明」。沿用现有 `psy_hits_` Bearer 密钥，无需 Cookie 或轮换密钥。所属管理员禁用、降级、密钥停用或轮换后立即失效。原文为管理员共享库；改写严格限密钥所属管理员。

基础地址：`https://factory.tiktokaitool.com/api/integrations/psychology/copy-library`。

| 方法和路径 | 用途 |
|---|---|
| GET 基础地址 | 分页读取原文 |
| GET `/{COPY_ID}` | 单篇原文、来源、指标、题材、高赞评论 |
| PATCH `/{COPY_ID}` | 修改原文或题材/评论 |
| GET `/{COPY_ID}/rewrites` | 当前密钥所属管理员的改写列表，评分降序 |
| GET `/{COPY_ID}/rewrites/{VERSION_ID}` | 单个改写的正文、模型、评分、翻译和质检结果 |
| PATCH `/{COPY_ID}/rewrites/{VERSION_ID}` | 修改该改写 |

所有请求都必须带 `Authorization: Bearer YOUR_API_KEY`。PATCH 必须是 `Content-Type: application/json`，最多1MiB。暂不开放删除、自动发布、生成或审批接口。

## 列表和 ID

```text
GET /api/integrations/psychology/copy-library?mediaType=photo&status=done&page=1&pageSize=20
```

- `mediaType`：all（默认）/photo/video；`status`：done（默认）/all/queued/running/failed。
- `q` 搜索标题、正文、原帖链接、文案ID，最多200字符。
- `page`：1–100000；`pageSize`：1–100，默认20。超范围返回400；超过最后一页返回空items。
- 原文列表按创建时间降序、ID稳定排序；返回 `items,total,page,pageSize,totalPages,hasMore`，重复分页直到 hasMore=false。并发新增期间如需遍历，按ID去重。
- 原文 ID 就是页面的 `psy-...` 文案ID。单篇返回 `{item:...}`，包含 `id,sourceKey,mediaType,title,sourceUrl,status,content,error,createdAt,updatedAt,revision,peer`；peer 含原帖完整数据及 `topics/topComments`。列表与单篇结构一致。
- 图文 `content.pages` 返回 `{index:1,text:"正文"}` 数组；视频返回 `content.transcript/onScreenText`。修改时图文 pages 用字符串数组。
- 改写列表同样支持 page/pageSize，status 为 all（默认）/pending/enabled/disabled。改写 ID 为64位字符串，返回 `externalId,sourceKey,title,caption,pages,enabled,rewriteModel,score,scoreReason,comparison,reviewStatus,reviewReason,rawResponse,createdAt,revision`。

## 修改原文

先 GET 读取最新 revision，再提交希望修改的字段；`revision` 是不透明字符串，不要自行计算，不要把整个 GET 对象原样回传。

```json
{
  "revision": "GET 返回的 revision",
  "title": "A pause can still mean care",
  "caption": "Ask for space and say when you will return.",
  "pages": ["第1页完整原文", "第2页完整原文"],
  "topics": ["avoidant", "boundaries"],
  "topComments": [{"text":"保留评论原话","likes":123}]
}
```

允许修改：`title`（非空，最多2000字符）、`caption`（最多12000字符，空字符串可清除）、图文 `pages`（1–6项有效正文，每页最多500字符，拒绝纯页码/符号）、视频 `transcript`（非空，最多12000字符）和 `onScreenText`（最多100项、每项2000字符）、`topics`（1–3个已有题材）、`topComments`（最多100候选，保留最高赞20条，空数组可清除）及 `topCommentsNote`（最多500字符）。未传字段保留，数组传入时整体替换。

成功返回 `{item:...}`，含新 revision。原文修改同步文案库和来源记录；正文修改清理旧图片文字缓存并使旧提取尝试失效。正在提取的原文返回409，请等结束后再改；未完成的原文只有补齐 pages/transcript 才会标记完成。仅修改题材/评论不会把失败文案错误标为完成。ID、来源链接、媒介类型、使用记录等不可通过此接口修改。已创建的发布任务仍使用原先冻结快照。

## 修改改写版本

```json
{"revision":"GET 返回的 revision","enabled":false,"score":92,"scoreReason":"钩子清晰","rewriteModel":"grokbot"}
```

允许修改 `title/caption/pages/enabled/rewriteModel/score/scoreReason/comparison`。title非空、最多200字符；caption最多2200字符；pages为1–6页字符串，每页最多1500字符；正文修改仍执行工厂的质量和跨来源重复检查。`score` 为0–100或null。`comparison` 沿用[导入的逐句翻译与原句对应结构](psychology-peer-hits-api.md)，null可清除。

正文变化时，未重新提交的旧评分、理由与翻译会清除，防止展示旧文本的评价；enabled默认保留原值。建议修改前停用、确认内容后再启用。待审核版本仍保持pending，API不得设置enabled=true绕过页面审核。原文/其他人的版本路径不匹配返回404。修改不创建新版本ID，如需单独比较不同内容的效果，应通过原POST导入新externalId。

## 错误与兼容

- 400：字段、结构、质量检查或分页无效，包含具体原因。
- 401：无密钥、失效密钥或所属管理员不可用。
- 404：文案/版本不存在，或不属于该原文/管理员。
- 409：revision缺失或过期、提取中、待审核版本不可启用。重新读取并核对冲突后再修改，不能盲目用新revision覆盖他人修改。
- 413 / 415：请求过大 / 非JSON内容类型；405：不支持的方法。

原 `GET /api/integrations/psychology/peer-hits` 继续返回 `watchAccounts/enrich` 清单。原 `POST` 继续新增或补充来源；不会覆盖已提取正文，要改正文请使用本PATCH。现有导入规则没有改成自动改写、每日抓取或每周回填。
