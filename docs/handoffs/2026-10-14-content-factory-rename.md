# 2026-10-14 心理学 → 内容工厂（第 2 步：改名与菜单重组）

## Goal
把侧边栏「心理学」分组改为「内容工厂」，按新结构重排菜单；只改显示名称与导航，不删功能、不动数据、不改路由与权限。

## Decisions
- 分组 ID、模块 ID、路由、权限 key、数据表名保持 `psychology*` 不变（改名无业务收益且风险高）。
- 新菜单顺序：爆款素材库、模板中心、文案库、发布、定时评论、自动运营、数据概览、独立站转化、运营报表、发布记录。
- 模板中心（原模板工作台 /psychology-templates）统一承载四图测试、纸张拼贴、单图互动测试、图文发布模板；子模板继续用 navigationParent 隐藏，不单独占侧边栏。
- 计划下线的入口（文案库来源管理、爆款复刻、模板题库、图文样式）改为挂在父模块下隐藏，页面和权限保留，等第 3 步删除。
- 定时评论、图文发布模板及纸张拼贴/单图互动测试模板按用户要求保留。
- 独立站转化保持紧跟数据概览（会员导航插入顺序依赖此位置）。

## Files changed
- factory-cloud/src/sidebar.js：菜单标签、顺序、分组名、待下线入口的 navigationParent。
- public/*.html（20 个）：`<title>`、品牌小字、部分 `<h1>` 改为内容工厂口径。
- public/psychology-video-hits.js：页面标题「视频爆款」→「爆款素材库」，document.title 后缀。
- factory-cloud/src/ui-asset-manifest.js：重新生成。
- 测试：psychology-module.test.js、psychology-auto-publish.test.js 更新为新名称。

## Tests performed
- `npm test`（factory-cloud）：1557 项，1537 通过，9 失败，与改动前基线完全一致（8 项因测试环境无 Chrome、1 项 PNG 卡片渲染，均为既有环境问题）。
- `node scripts/ui-asset-manifest.mjs --check` 通过。

## Unfinished work
- 页面正文、服务端报错文案中的「心理学」字样未改。
- 未新增 /content/* 路由别名；URL 仍为 /psychology-*。

## Recommended next step
第 3 步：在已排任务结束、确认无排队任务后，删除文案库来源管理、爆款复刻、模板题库、图文样式、图文工厂及自动运营中停用的子功能（任务分组、过渡日、素材池匹配、转化活动、文案库模式）；然后把文案库并入爆款素材库，并给爆款加 niche（赛道）字段。
