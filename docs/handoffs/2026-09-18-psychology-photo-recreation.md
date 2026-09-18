# Goal

图文爆款点击复刻后，按对标图自动判断走文案图片还是素材库图片，不再走 AI 生图。

# Decisions

- Gemini 3.8 Flash 逐张分类：纯文字/纸张卡片走封面或内容文案模板；有摄影底图则用英文画面描述搜索 Pexels，再让 Gemini 从候选里挑最接近的一张。
- 复刻页提供「改写文案」开关，默认开启；关闭时提取原图叠字，不改写。
- 云端只产出分类结果和素材 URL，浏览器在 `/psychology-photo?peerJob=` 渲染进图集后发布。

# Files changed

- `scripts/psychology-peer-production.js`
- `factory-cloud/src/peer-photo-workflow.js`
- `factory-cloud/src/psychology-peer-production.js`
- `factory-cloud/src/jobs.js`
- `public/psychology-peer-hits.html`
- `public/psychology-peer-hits.css`
- `public/psychology-peer-production.js`
- `public/psychology-photo.js`
- `public/psychology-photo.html`
- `public/psychology-production.js`
- `docs/CURRENT_STATE.md`
- `docs/psychology-peer-hits-api.md`

# Tests performed

- `node --test factory-cloud/src/psychology-peer-production.test.js factory-cloud/src/psychology-peer-hits.test.js factory-cloud/src/psychology-module.test.js`

# Unfinished work

- 线上用真实图文帖验证 Gemini 分类和 Pexels 相似度。
- 混图图集在图文页仍按首张切换左侧模板面板，图集本身可混合文案卡和素材卡。

# Recommended next step

在图文爆款选一条纯文字帖和一条有底图帖，分别开/关「改写文案」复刻，确认图文页渲染后可发布。
