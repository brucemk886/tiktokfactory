# Goal

查清图文复刻 `2 times retry fail` 的真实失败点，并让后续失败能看到原始原因。

# Decisions

- 线上任务 `peer-06b3933a13276e9ef624928019fb8448-0` 的 HEIC 转码已成功；失败发生在 `story-0`（Kie Gemini 看图分类），Cloudflare Workflows 把提供商错误盖成 `2 times retry fail`。
- 看图请求改为把已转码的 JPEG 以内嵌 `data:image/jpeg;base64,...` 发给 Kie，不再让 Kie 回拉工厂签名 URL。
- 付费/转码步骤不再从 `step.do` 向外抛错，避免 Workflows 重试包装；任务 `error` 字段保存原始消息。

# Files changed

- `factory-cloud/src/peer-photo-workflow.js`
- `factory-cloud/src/peer-photo-convert.js`
- `factory-cloud/src/kie.js`
- `factory-cloud/src/peer-photo-convert.test.js`
- `factory-cloud/src/psychology-peer-production.test.js`
- `factory-cloud/src/kie.test.js`
- `docs/CURRENT_STATE.md`
- `docs/psychology-peer-hits-api.md`

# Tests performed

- `node --test factory-cloud/src/peer-photo-convert.test.js factory-cloud/src/psychology-peer-production.test.js factory-cloud/src/kie.test.js`

# Unfinished work

- 上线后用同一条图文帖再点一次复刻，确认能过 Gemini 分类。
- 成本监控仍未完成。

# Recommended next step

部署后在图文爆款重试该帖；若仍失败，界面应直接显示 Kie 原文而不是 retry fail。
