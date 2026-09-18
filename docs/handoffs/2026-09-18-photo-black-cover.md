# Goal

去掉 30 套封面底图选择器，封面统一黑底白字。

# Decisions

- 放大/删除按钮叠在缩略图上无法操作。用户要求全部删除底图，封面不再随机抽模板。
- `renderCoverCard` 固定铺 `#111111`，居中衬线字 `#f4f1ea`。手动生成、复刻、自动发布工人共用这一套。
- 删除 `psychology-cover-backdrops.js` 和封面模板页的底图网格。

# Files changed

- `public/psychology-card-renderer.js`
- `public/psychology-photo.js`
- `public/psychology-photo.html`
- `public/psychology-photo.css`
- `public/psychology-cover-backdrops.js`（删除）
- `scripts/psychology-auto-photo-job.js`
- `factory-cloud/src/psychology-module.test.js`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test factory-cloud/src/psychology-module.test.js`

# Unfinished work

- 旧图集里已经生成的彩色封面不会自动换成黑底，需重新生成。

# Recommended next step

强刷 `/psychology-photo`，封面模板直接生成黑底白字；复刻封面也走同一套。
