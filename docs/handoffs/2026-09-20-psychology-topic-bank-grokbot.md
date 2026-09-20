# Goal

给心理学模板题库增加与同行爆款同款的 grokbot 写入接口。

# Decisions

- 独立密钥表 `psychology_template_topic_keys`，前缀 `psy_topics_`，与同行爆款 `psy_hits_` 分开。
- 外部地址 `POST /api/integrations/psychology/template-topics`，登录前分发，只写不读。
- 每条带 `template`（或请求顶层 fallback）：`psychology` / `psychology-collage` / `psychology-target-2`。相同题目+内容跳过，不覆盖已有记录。
- 管理入口在 `/psychology-topic-bank` 右上角「写入接口」。

# Files changed

- `factory-cloud/migrations/0033_psychology_template_topic_keys.sql`
- `factory-cloud/src/psychology-topic-bank.js`
- `factory-cloud/src/psychology-topic-bank.test.js`
- `factory-cloud/src/index.js`
- `scripts/psychology-topic-bank.js`
- `public/psychology-topic-bank.html`
- `public/psychology-topic-bank.js`
- `public/psychology-topic-bank.css`
- `docs/psychology-template-topics-api.md`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test factory-cloud/src/psychology-topic-bank.test.js factory-cloud/src/psychology-auto-publish.test.js`

# Unfinished work

- grokbot 侧需要配置新密钥和字段映射。

# Recommended next step

管理员打开模板题库生成密钥，交给 grokbot 按文档写入 01/02/03 题库。
