# 2026-10-15 承接引导超长时自动截短文案

## Goal
修复：一条二创文案追加 @承接账号 引导后超过 TikTok 2200 字上限时，整轮发布失败。
2026-10-15 00:30（北京时间）「流量正常 · 视频」一轮 20 个账号因此全部未创建任务（schedule_work 重试 5 次后 failed）。

## Decisions
- 新增 `scripts/psychology-caption-fit.js` 的 `fitCaptionWithCTA(caption, cta)`：总长 ≤ 2200 时与原行为一致；超长时保留完整引导语，截短原文案（尽量在 80 字内的词边界处断开，去掉末尾空白/#/@，加「…」）。
- 计数沿用既有 `.length`（UTF-16）口径，截短按完整字符进行，不拆 emoji。
- 结果保持幂等：已截短文案再次处理时原样返回，重试不会二次截短或改变冻结文案。
- 引导语本身就放不下时仍报错（属配置错误）。
- 截短时输出结构化日志 `receiver-caption-truncated` / `imported-photo-caption-truncated`（只含账号名与长度）。
- 接入两条路径：`applyPhotoReceiverCaption`（视频/图文 @承接账号）与 `importedPhotoCaption`（导入图文转化）。转化活动（psychology-conversion.js）计划下线，未改动。

## Files changed
- scripts/psychology-caption-fit.js（新）、scripts/psychology-caption-fit.test.js（新）
- factory-cloud/src/psychology-photo-receivers.js、scripts/psychology-imported-photo-policy.js
- 测试：psychology-photo-receivers.test.js、psychology-imported-photos.test.js 中「超长即报错」断言改为「截短且 ≤2200」
- factory-cloud/package.json：加入新测试

## Tests performed
`npm test`：1563 项，1543 通过，9 失败，与基线一致（均为测试环境缺 Chrome / PNG 渲染）。新增 6 项全部通过。

## Unfinished work
- 已失败的 10/15 00:30 一轮不会自动补发（所属计划已结束）。

## Recommended next step
部署后观察 Worker 日志中的 `*-caption-truncated` 事件，确认截短频率；如频繁，可在 grokbot 导入端限制文案长度。
