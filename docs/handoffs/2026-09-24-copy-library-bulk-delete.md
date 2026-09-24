# 2026-09-24 文案库全选与批量删除

## Goal
为心理学文案库的视频、图文列表增加全选本页和批量删除。用户明确确认删除所选文案、同行来源和关联改写。

## Decisions
- 表头复选框与「全选本页」按钮选择当前页（最多 20 条）；翻页后清除不在当前页的选择。
- 删除确认展示数量与范围；请求失败保留选择，重复点击不会重复发送。
- 统一单条「删除文案」与批量删除语义。原帖复刻保持每次最多 5 条。
- 管理员且具备来源管理权限才可删除。服务端限制 1–20 个有效 ID，并校验 Origin。
- 一个 D1 batch 事务删除来源、原文与对照缓存，关联改写软删除并停用；保留既有生成任务、发布任务、内容快照和使用历史。
- 不自动删除任何线上文案。实际删除由用户勾选并确认触发。

## Files changed
- public/psychology-copy-library.html
- public/psychology-peer-hits.js
- public/psychology-peer-production.js
- factory-cloud/src/psychology-copy-library.js
- scripts/psychology-copy-library-ui.test.js
- factory-cloud/src/psychology-copy-library.test.js

## Tests performed
- 专项测试 26/26 通过：全选、半选、翻页、权限、确认取消、重复点击、失败重试、关联删除、历史任务保留、幂等和事务回滚。
- npm --prefix factory-cloud test：647/647 通过。
- git diff --check 通过。

## Unfinished work / Next step
按仓库要求提交并推送 main 后部署；线上仅验证全选/清空交互，不调用真实删除。
