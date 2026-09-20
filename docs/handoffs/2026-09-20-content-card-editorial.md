# Goal

把图文内容卡改成对标列表页：页码、一句加粗、底部简笔，去掉重复的粗标题。

# Decisions

- 标题和正文相同只印一次；Title Case 收成小写句子；自动给 2–4 个词加 `**bold**`。
- 内容卡改衬线字，顶部印 `2.` / `3.`，底部按页码轮换 6 种简笔小人。两条 labeled 定义（anxious: / avoidant:）不配插画。
- 封面黑底不变。复刻和自动发布出图都走同一套 `buildTextCardSlides`。

# Files changed

- `public/psychology-text-card.js`
- `public/psychology-card-renderer.js`
- `public/psychology-photo.js`
- `public/psychology-photo.html`
- `scripts/psychology-auto-photo-job.js`
- `scripts/psychology-peer-production.js`
- `factory-cloud/src/psychology-module.test.js`
- `factory-cloud/src/psychology-peer-production.test.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test factory-cloud/src/psychology-module.test.js factory-cloud/src/psychology-peer-production.test.js ../scripts/psychology-auto-photo-job.test.js`

# Unfinished work

- 简笔是几何小人，不是对标那种插画师线稿。
- 已生成的旧图不会重渲，需要再点一次复刻或重新出内容卡。

# Recommended next step

对一条图文爆款再复刻一次，看内容页是否变成页码 + 一句加粗 + 底部简笔。
