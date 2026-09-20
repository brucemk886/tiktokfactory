# Goal

去掉内容卡底部按页码轮换的简笔小人，以及「双行定义不加插画」这套判断。

# Decisions

- 内容卡只保留页码、一句加粗、去重。底部不再画人。
- `anxious:` / `avoidant:` 仍可排成两行文字，但不再为此开关插画。

# Files changed

- `public/psychology-card-renderer.js`
- `public/psychology-text-card.js`
- `public/psychology-photo.js`
- `public/psychology-photo.html`
- `factory-cloud/src/psychology-module.test.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test factory-cloud/src/psychology-module.test.js ../scripts/psychology-auto-photo-job.test.js`

# Unfinished work

- 已生成的带小人旧图需重新出卡。

# Recommended next step

刷新图文页后再复刻一条，确认底部是空的。
