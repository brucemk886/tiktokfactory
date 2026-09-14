# 模板2最终采用逐条录制、逐条合成

日期：2026-09-06
状态：代码已恢复为用户最终确认的逐条方案，未提交、未部署；真实Minecraft录制联调仍待完成。

## 最终决定

用户比较耗时和连贯性后明确选择「一条条来」。数量与音频选择继续沿用任务设置和原规则。处理一条音频时先读取/生成字幕缓存、录制本条独立的新画面、质检、合成已有小说元素；完成后再处理下一条。

每条仅使用其自己的新录制片段，余量裁掉，不转给下一条。现有单段/多地图拼接规则仍保留：地图不够长时可能需要拼接，不能保证任意音频都能无切换地用单一地图覆盖。没有全批先录、公共尾料池、跨视频时间区间分配，也不再使用批次清单。

## 文件和行为

- scripts/reddit-mix-job.js：恢复逐条调用模拟器和合成；移除批次预录、跨视频片段分配和批次断点入口。原音频轮换、小说关联、字幕和推广元素保持。
- scripts/minecraft-recording-client.js：区分单条录制失败与系统故障。质检失败/本条结果无效可跳过；模拟器断线、游戏退出、磁盘空间不足、中断和取消停止整批。
- D:/cursor/minecraft/src/main.js：将 fatalBatch 标记随录制失败结果回传，模拟器已重新构建。
- public/tasks.js：说明更新为逐条录制合成。
- scripts/minecraft-recording-client.test.js：增加失败分类验证。
- scripts/minecraft-recording-smoke.js：改为逐条交替执行、单条跳过及系统故障停止的隔离验证。
- 删除本任务创建且不再使用的 scripts/minecraft-batch.js、scripts/minecraft-batch.test.js。
- 本地 auto-task-manager 传入 taskId 的改动保留，用于请求归属；不再用于批次清单。

单条失败仍沿用生成循环的尝试上限和继续下一候选逻辑。目标数量是成功产出数量；失败不计入成功数量。没有新增完整的逐条断点恢复系统，不能沿用已废弃批量方案的断点能力描述。

## 验证

相关回归56/56通过：客户端、模板、混剪编码、小说元素、工人、任务管理及模拟器桥接。相关语法检查、git diff --check和模拟器npm run build通过。既有Vite体积提示仍存在。

隔离测试使用合成画面和测试音频，不启动游戏或调用发布接口：
- 第一次回传质检失败，然后完成3条视频，共4次录制请求。
- 每次新录制请求都断言上一条成片已完成。
- 3条成片各用不同源片段，从0秒开始，余下5秒不转用给其他成片。
- 全部音视频完整解码成功，保留字幕、开头、推广码、片尾及小说/文案关联。
- 模拟游戏不可用时，只有1次录制请求，整个生成任务失败停止。
- 产物：artifacts/minecraft-sequential-smoke-1788683084880/verification.json。

复跑：
```powershell
node --test scripts/minecraft-recording-client.test.js scripts/video-template.test.js scripts/reddit-mix-encode.test.js scripts/novel-video-badge.test.js scripts/factory-cloud-worker.test.js scripts/auto-task-manager.test.js D:/cursor/minecraft/tests/factory-recording.test.mjs
node scripts/minecraft-recording-smoke.js
```

## 未完成与下一步

真实游戏必须先进入单人世界，再做1条真实音频的联调。本次没有真实录制耗时对照结论。

线上未部署。两个仓库原有未提交改动被保留；遵守AGENTS.md的提交推送main、干净工作树、HEAD==origin/main发布门槛。不要打断现有录制或发布来更新服务。

本文件替代 2026-09-06-template2-batch-record-then-compose.md 中所有批量方案的当前状态描述；批量文件只作讨论/历史记录。
