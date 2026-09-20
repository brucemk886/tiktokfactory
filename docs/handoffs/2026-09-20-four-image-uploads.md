# Goal

把心理学 01 四图测试模板改成上传 A/B/C/D 四张图片，并各填一段对应文案，成片用这四张图拼画面，不再靠一段选项文本去 Z-Image 生图。

# Decisions

- 模板题库 01 弹窗改为四宫格：每格一张图 + 文案。图片进 R2 `psychology-topics/{uuid}.ext`，题目 `content` 存 JSON choices。
- 旧的 `A: Moon | https://...` 文本仍能解析，编辑时回填；grokbot 可传 `choices[].imageUrl`。
- 自动发布抽到四图题目时冻结 `choiceImages`；本机工人用 ffmpeg 拼 2×2（横版 1×4），叠 A–D 徽章和文案，再走原有配音/动效。
- 四图工作台同样改为上传四图；本地任务把 dataUrl 放进 payload。

# Files changed

- `scripts/psychology-topic-bank.js`, `scripts/psychology-four-image.js`, `scripts/psychology-video-job.js`, `scripts/auto-task-manager.js`
- `factory-cloud/src/psychology-topic-bank.js`, `psychology-auto-publish.js`, `jobs.js`
- `public/psychology-topic-bank.{html,css,js}`, `public/psychology-topic-import.js`, `public/psychology.{html,js,css}`
- tests and `docs/psychology-template-topics-api.md`

# Tests performed

- `node --test scripts/psychology-four-image.test.js factory-cloud/src/psychology-topic-bank.test.js factory-cloud/src/psychology-auto-publish.test.js`
- factory-cloud `npm test` after UI wiring

# Unfinished work

- 题库里还没有四张图的旧题目，自动发布会直接报需要 A/B/C/D 图片；需要补图或重新导入。
- 浏览器里要强制刷新后再打开「新增题目」。

# Recommended next step

在模板题库 01 新增一条带四张图的题目，抽一条自动发布确认拼图。
