# 小说 AI 自运营与项目中台精简

## Goal

- 删除项目中台的子项目 Agent 与 Agent 运行队列。
- 保留项目、模块边界、共享记忆和交接记录。
- 将原运营大脑改为小说 AI 自运营，并通过现有 Reddit 自动发布链路执行一周闭环运行。

## Decisions

- DeepSeek V4 Flash 继续遍历完整私有视频数据，SOL 继续负责最终策略决策。
- 账号阶段、每日抓取、19:00 策略时间、方案审核、自动建任务开关和 GeeLark 安全限制保持不变。
- 所有任务统一使用当前已保存的 Reddit 小说音频、素材、字幕和去重配置。
- 统一使用现有 Reddit 自动发布流程；AI 仅分析账号阶段、样本量和发布时间，不修改视频生成参数。
- 运营方案生成标准 `reddit` 自动任务，复用已保存的字幕与去重配置，并继续使用现有队列、失败跳过、重试和发布记录逻辑。
- 项目中台只保留项目注册、启用状态与交接记忆；旧 Agent 与 run 数据在存储迁移时移除。

## Files Changed

- `scripts/operation-brain.js`
- `scripts/codex-brain.js`
- `scripts/deepseek-brain.js`
- `scripts/server.js`
- `scripts/project-hub.js`
- `public/operator.html`
- `public/operator.js`
- `public/operator.css`
- `public/project-hub.html`
- `public/project-hub.js`
- `public/project-hub.css`
- focused test files and durable documentation

## Tests Performed

- JavaScript syntax checks for the changed server, strategy, project-hub, and browser modules.
- Focused Project Hub, Operations Brain, DeepSeek, Codex Brain, and sidebar-permission tests: 28/28 passed.
- Full repository test run: 69/70 passed. The only failure is the pre-existing `auto-task-schedule.test.js` expectation that a schedule over 300 items throws; `scripts/auto-task-manager.js` was not changed in this work.
- No GeeLark publishing API was called.

## Unfinished Work

- A service restart is required before the running local instance serves the new routes and UI. Do not restart while active rendering or publishing jobs are running.
- The operator must select a valid asset group or video directory and a novel audio directory before generating the first plan.
- Reconcile the existing 300-item schedule-limit test with the current automatic-task behavior in a separate publishing-safety task.

## Recommended Next Step

After active jobs finish, restart Local Factory, configure the novel sources and account groups, generate a draft plan, review account stages and publishing times, then enable automatic task creation for the seven-day run.
