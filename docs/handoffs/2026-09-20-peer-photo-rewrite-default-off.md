# Goal

同行爆款图文复刻的「改写文案」默认关闭，打开页面时不勾选，未显式打开时保留原帖文字。

# Decisions

- `/psychology-peer-hits` 复选框去掉 `checked`，提交只在勾选时发送 `rewriteCopy: true`。
- 云端创建图文复刻任务和 `peerProductionPayload` 缺省均为 false，与 `/psychology-publish` 一致。
- 工作流按 `rewriteCopy === true` 才改写；已入队且 payload 写了 true 的任务不受影响。

# Files changed

- `public/psychology-peer-hits.html`
- `public/psychology-peer-production.js`
- `scripts/psychology-peer-production.js`
- `factory-cloud/src/psychology-peer-production.js`
- `factory-cloud/src/peer-photo-workflow.js`
- `factory-cloud/src/psychology-peer-hits.test.js`
- `factory-cloud/src/psychology-peer-production.test.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test factory-cloud/src/psychology-peer-hits.test.js factory-cloud/src/psychology-peer-production.test.js`

# Unfinished work

- 无。

# Recommended next step

打开同行爆款图文页，确认「改写文案」默认未勾选；不勾选复刻应提取原文。
