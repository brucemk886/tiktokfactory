# Goal

图文复刻看图默认改用 Kie Gemini 3.5 Flash，失败再回退 3.8 Flash。不走 Google 官方。

# Decisions

- 分类和底图挑选都先打 `gemini-3-5-flash`，同一请求失败才打 `gemini-3-8-flash`。
- 看图任务用 `reasoning_effort: low`，避免 3.8 思考模式拖成内部错误。
- JSON 校验失败仍在当前已成功的模型上重试，不因为格式问题立刻切 3.8。

# Files changed

- `factory-cloud/src/peer-photo-workflow.js`
- `factory-cloud/src/kie.js`
- `factory-cloud/src/kie.test.js`
- `factory-cloud/src/psychology-peer-production.test.js`
- `docs/CURRENT_STATE.md`
- `docs/psychology-peer-hits-api.md`

# Tests performed

- `node --test factory-cloud/src/peer-photo-workflow` via `psychology-peer-production.test.js` and `kie.test.js`

# Unfinished work

- 用真实图文帖再点一次复刻验证 3.5 能过。

# Recommended next step

部署后重试先前失败的图文帖。
