# 模板2改为先批量录制、再批量合成

> 已废弃：用户最终选择逐条录制、逐条合成。当前实现见 `2026-09-06-template2-sequential-final.md`，本文不是待执行方案。

日期：2026-09-06
状态：代码完成，本地隔离验证通过；未提交、未部署，真实游戏联调仍待完成。

## 目标和范围

用户要求模板2从「录一条、合成一条」改为「先批量录制，再批量合成」。数量完全沿用创建任务时的 totalVideos 和既有上下限，音频仍沿用原来的选择/轮换规则，没有固定为40、49或其他数量，没有修改全局音频排序，也没有继续执行全库字幕缓存匹配。

本交接替代 2026-09-06-template2-minecraft-autorecord.md 中的逐条录制调度描述；模拟器连接、质检、启动前提和发布约束不变。

## 实现

1. 本次任务选到的音频、时长、轮换结果写入本批次清单，避免两个阶段之间重新抽取另一批音频。数量来自任务参数。
2. 先完成本批所需画面的录制与质检，每次返回合格整图片段后保存断点，直到可用帧数覆盖全部音频。
3. 全批录够后才进入合成阶段。字幕读取既有缓存，无缓存时沿用原识别流程；添加已有音频、字幕、推广码、开头和片尾设置。
4. 按时间区间分配片段。前一条用过的区间不会重复，剩余画面直接接给下一条；仅本批最后一段可能有未使用尾料。时间按输出帧率分配，避免小数误差造成重叠。
5. 批次清单位于配置 workDir/minecraft-batches。已接受片段和已完成成片保留断点；同一任务重试不会重抽音频、重录所有素材或重复合成已存在的成片。正在录制但尚未回传确认的单段可能需要重录。
6. 本地任务向生成子进程传入稳定 taskId；云任务已携带该字段。每次执行变化的 jobId 不改变批次身份。
7. 批次失败不自动换一条音频掩盖错误。音频被修改、录制片段缺失、配置改变等情况会明确停止；恢复文件/修正元数据后继续，改变生成配置应新建任务。
8. 锁只保证同一批次不被两个进程同时处理。每个批次内部录制与合成分阶段执行，不表示全机器其他类型任务也会暂停。

## 文件

- scripts/minecraft-batch.js：清单、分配、阶段、断点与同批次锁。
- scripts/reddit-mix-job.js：批次录制前置、按已分配起止位置合成、恢复已完成结果和阶段进度。
- scripts/auto-task-manager.js：本地生成传入稳定 taskId。
- public/tasks.js：模板2说明改为先批量录制、后批量合成。
- scripts/minecraft-batch.test.js：5项批次专项测试。
- scripts/minecraft-recording-smoke.js：升级为3条成片、两轮录制及已完成任务重试验证。
- docs/CURRENT_STATE.md：更新本地实现状态。

## 测试

相关回归53/53通过：批次、录制客户端、旧模板、合成编码、小说元素、工人和自动任务管理。JS语法与 git diff --check 通过。

隔离成片测试：3条12秒音频，模拟器回传使用合成测试画面，分两轮回传17秒片段。测试断言第二轮录制发生时输出目录仍无任何成片，之后才开始批量合成。

分配核验：第1条用第1段0–12秒；第2条用第1段12–17秒和第2段0–7秒，验证剩余部分继续使用且不重叠。三条均通过FFmpeg完整解码。第2条中段截图已视觉核验，字幕与推广角标正常。再次执行同一taskId、不同jobId，没有录制或重新编码，原成片修改时间保持不变。

最新产物和验证记录：artifacts/minecraft-recording-smoke-1788682060149/verification.json。

复跑：
```powershell
node --test scripts/minecraft-batch.test.js scripts/minecraft-recording-client.test.js scripts/video-template.test.js scripts/reddit-mix-encode.test.js scripts/novel-video-badge.test.js scripts/factory-cloud-worker.test.js scripts/auto-task-manager.test.js
node scripts/minecraft-recording-smoke.js
```

上一交接中模拟器既有Java预热帧断言失败仍不属于此次批次修改；本轮没有修改模拟器代码或重跑该无关测试。

## 剩余工作

进入真实Minecraft单人世界后做小批次实录联调；这次未执行实际游戏录制，没有实测两种方案的实际总耗时。

预期节省主要来自「逐条累计丢弃尾料」减去「整批最后余量」，不是并行带来的加速。真实音频与整图时长通常不完全匹配，不能默认两种方案差别很小；具体分钟数须按实录速度及切图/质检耗时计算。

未部署：仓库仍有本任务之前的未提交改动。遵守根AGENTS.md，整理、提交并推送main，在干净工作树且HEAD==origin/main后才可从factory-cloud运行npm run deploy。不得打断现有录制或发布。
