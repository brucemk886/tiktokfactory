# Goal

把 03「互动测试模板」改成「单图互动测试模板」：上传一张图，并自行填写 A/B/C/D 选项。

# Decisions

- 题库 `psychology-target-2` 内容 JSON 为 `{kind:"single-image-quiz",imageKey|imageUrl,choices:[{label,copy}]}`，与 01 四图 JSON 分开，避免被当成四张图解析。
- grokbot 仍可只交题目；自动发布和工作台出片必须有一张图和四个选项。
- 成片强制 `character-choice` / `choices-4` 叠字；有上传图时跳过 Z-Image。
- 工作台去掉题型选择器，改为单图上传 + A/B/C/D 文案。

# Files changed

- `scripts/psychology-topic-bank.js`
- `scripts/psychology-four-image.js`
- `scripts/psychology-narrative.js`
- `scripts/psychology-narrative-job.js`
- `scripts/server.js`
- `scripts/psychology-auto-publish.js`
- `factory-cloud/src/psychology-topic-bank.js`
- `factory-cloud/src/psychology-auto-publish.js`
- `factory-cloud/src/sidebar.js`
- `public/psychology-topic-bank.*`
- `public/psychology-narrative.*`
- `public/psychology-templates.html`
- `remotion/psychology-landscape.jsx`
- `docs/psychology-template-topics-api.md`
- `docs/CURRENT_STATE.md`

# Tests performed

- `node --test` covering topic bank, auto-publish, narrative, four-image helpers, psychology-module

# Unfinished work

- 旧的 03 题库只有题目、没有图和选项的记录，自动发布会失败，需要补图或停用。

# Recommended next step

管理员打开模板题库 03 页，补一张测试图和四个选项后跑自动发布。
