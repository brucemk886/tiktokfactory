# Goal

图文复刻看图默认改用官网 DeepSeek V4.1 Flash（`deepseek-flash`），失败再回退 Kie Gemini 3.8 Flash。不走 Google 官方，也不再默认打 Gemini 3.5 Flash。

# Decisions

- 工厂云新增 `factory-cloud/src/deepseek.js`，直连 `https://api.deepseek.com/chat/completions`，密钥用 Cloudflare Secret `DEEPSEEK_API_KEY`，与本机运营大脑同一把官网 Key。
- 分类和底图挑选都先打 `deepseek-flash`，thinking 关闭；同一请求失败才打 Kie `gemini-3-8-flash`（`reasoning_effort: low`）。
- 原图仍先转 JPEG/PNG/WebP，再以内嵌 data URL 传图，不让上游回拉工厂临时地址。
- 未配置 DeepSeek 密钥时直接走 3.8，任务不因此排队失败。
- JSON 校验失败仍在当前已成功的模型上重试，不因为格式问题立刻切 3.8。

# Files changed

- `factory-cloud/src/deepseek.js`
- `factory-cloud/src/deepseek.test.js`
- `factory-cloud/src/peer-photo-workflow.js`
- `factory-cloud/src/psychology-peer-production.test.js`
- `factory-cloud/package.json`
- `docs/CURRENT_STATE.md`
- `docs/psychology-peer-hits-api.md`

# Tests performed

- Focused: `deepseek.test.js` and `psychology-peer-production.test.js`, 27 passed.
- Factory suite: 370 passed. One pre-existing `apply-remote-migrations` case still fails because `HEAD` is the migration commit `0028`; not part of this change.

# Unfinished work

- 用真实图文帖再点一次复刻，确认 DeepSeek 看图能过；失败任务需删除或重试。

# Recommended next step

部署后重试先前失败的图文帖。
