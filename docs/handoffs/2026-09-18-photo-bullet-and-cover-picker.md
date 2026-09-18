# Goal

去掉内容页重复圆点，并让封面 30 套底图能在图文页预览筛选。

# Decisions

- 内容模板会自己画 `•`。复刻走 `copies` 时原先不剥原文圆点，所以会出现两个点。现在 `copies`/`body` 都走 `parseCardBullets`/`stripListMarker`，绘制前再剥一次。
- 封面底图一共 30 套，不是 50。入口在 `/psychology-photo` → 文案图片 → 封面模板。缩略图为 9:16 竖版，每张有放大和删除；删除后随机生成和复刻封面不会再用。选择存在浏览器 localStorage。

# Files changed

- `public/psychology-text-card.js`
- `public/psychology-card-renderer.js`
- `public/psychology-cover-backdrops.js`
- `public/psychology-photo.js`
- `public/psychology-photo.html`
- `public/psychology-photo.css`
- `factory-cloud/src/psychology-module.test.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test factory-cloud/src/psychology-module.test.js`

# Unfinished work

- 自动发布工人仍从全部 30 套里随机，不读浏览器筛选。

# Recommended next step

强刷 `/psychology-photo`，打开封面模板看 30 套底图；复刻列表页应只剩一个圆点。
