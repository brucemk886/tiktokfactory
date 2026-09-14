# 模板2：线上任务驱动 Minecraft 自动录制

日期：2026-09-06
状态：代码已实现，模拟器前端已构建；未提交、未部署；真实游戏录制待联调。

## 目标与实现

线上官方小说任务选择「模板2 · 我的世界自动录制」并创建任务后，将 `videoTemplate: parkour`、`parkourSource: simulator` 传给所选本地工人。工人按每条音频的实测时长请求新画面，再走现有字幕、开头文案框、小说平台/推广码、片尾引导及官方发布链路。

- 新建模板2任务不再需要旧视频目录。没有 `parkourSource: simulator` 的历史任务保持目录模式，模板1不变。
- 本地工厂自动启动相邻 `D:/cursor/minecraft` 源码版 Electron 模拟器（使用已构建的 dist）。已连接实例直接复用。
- 模拟器从当前选择的成品地图开始，沿用地图轮换、随机变体和画质设置，整图录制、质检；总时长不足则继续录下一图。连续三次质检拒绝即失败，最多尝试40段。
- 仅将质检接受后的实际文件路径回传；工厂再次通过 ffprobe 验证时长，再拼接并裁到音频时长。不会退回旧素材。
- 字幕仍使用现有 ElevenLabs 识别/缓存；开头、推广码和结尾仍由已有小说/文案/音频关联及开关决定。推广码缺失的既有前置拦截保留。
- 成片记录保留小说、文案、音频及源片段关联，增加 `parkourSource`。
- 文件队列位于配置的 `workDir/minecraft-recording`。待处理请求放 `requests/`，终态请求移出待处理目录；历史结果不参与每秒队列扫描。
- 单实例队列锁、串行领取、工厂进程归属检查、取消信号、心跳、超时和中断结果保护均已实现。手动录制以及其他实例的有效原生任务不会被抢占；取消工厂录制不清空手动断点。
- 原任务重试会用新的本次执行标识，避免旧失败记录永久阻断重试。

## 本机配置与前提

默认目录无需改配置。其他机器可在其本机 `config.json` 增加（不要把执行路径放进云任务）：

```json
{
  "minecraftSimulator": {
    "root": "D:/cursor/minecraft",
    "autoStart": true
  }
}
```

`executable` 可指向包含新桥接代码的打包版 exe。源码版需先在模拟器目录运行 `npm run build`，并保留 node_modules 中 Electron。自定义工作目录会通过 `LOCAL_FACTORY_BRIDGE_DIR` 自动传入启动的模拟器；手动启动非默认布局时也应设置该环境变量。

Minecraft 本身需要完成登录、安装对应 Fabric 模组，并进入单人世界；此次实现自动启动的是模拟器，未实现游戏账号登录或从 Launcher 冷启动进入世界。旧模拟器如果仍开着，需要等当前录制结束后重新打开更新版本。不要为了更新打断正在工作的实例。

## 改动文件

Local Factory：
- `public/tasks.html`、`public/tasks.js`：新建任务选择与参数。
- `factory-cloud/src/compat.js`、`scripts/auto-task-manager.js`、`scripts/server.js`、`scripts/video-template.js`：线上/本地创建校验、归一化与兼容模式。
- `scripts/minecraft-recording-client.js`：自动启动与本地文件协议。
- `scripts/reddit-mix-job.js`：取新画面、时长验证、原合成流程、录制异常终止、取消状态保持。
- `scripts/minecraft-recording-client.test.js`、`scripts/minecraft-recording-smoke.js`：接口/客户端测试与隔离成片验证。

相邻 Minecraft 仓库：
- `electron/factory-recording-bridge.cjs`、`electron/main.cjs`、`electron/preload.cjs`：本地桥接与 IPC。
- `src/factory-recording.js`、`src/main.js`：录制编排、质检结果回传、互斥及进度。
- `tests/factory-recording.test.mjs`；`tests/minecraft.test.mjs` 仅更新受本次参数优先级变化影响的断言，保留已有其他改动。

## 验证结果

1. 新增测试13项全通过：云端真实创建路由（数据库替身）、参数保持、客户端结果验证、取消/断线/质检错误、桥接独占/串行/中断/进程归属、时长补足、其他原生任务互斥。
2. 完整相关回归98项：97通过，1失败。失败是既有 `automatic recording captures Minecraft's internal landscape framebuffer`：测试断言 `capturePrerollTicks = 24;`，当前模组代码已经是依据地图起点选择80或24的表达式。本次未修改该 Java 模组逻辑，也未放宽这一无关断言。
3. 模拟器 `npm run build` 成功；相关JS/CJS语法检查与 Local Factory `git diff --check` 通过。Vite有既有bundle体积提示。
4. 实机空队列启动检查：通过客户端启动入口打开 Electron，renderer 成功写出健康心跳。确认无录制任务后仅关闭测试创建的实例。日志目录：`artifacts/minecraft-bridge-launch-smoke-1788680717284`。
5. 隔离合成测试成功：实际工厂入口 + 实际文件桥接模块，模拟器画面回传由两段7秒合成测试图代替，12秒测试音轨走字幕缓存。产出1080×1920视频，包含2段拼接、开头、逐词字幕、平台/TEST123角标和片尾；音视频完整解码及帧检查通过。未调用语音识别收费接口或发布接口。
6. 最新隔离产物：`artifacts/minecraft-recording-smoke-1788680791903/verification.json` 和其中的 MP4、frame-1/6/10.png。首轮同样成片的三个时间点已人工视觉核验。

复跑：
```powershell
node --test scripts/minecraft-recording-client.test.js scripts/video-template.test.js scripts/reddit-mix-encode.test.js scripts/novel-video-badge.test.js scripts/factory-cloud-worker.test.js D:/cursor/minecraft/tests/factory-recording.test.mjs
node scripts/minecraft-recording-smoke.js
npm --prefix D:/cursor/minecraft run build
```

## 未完成与下一步

- 当时游戏原生心跳停留在前一天，未执行真实游戏录制；需要进入单人世界后先做1条3–5分钟音频的生成任务，确认原生录制、质检和完整合成。
- 当前两个仓库均有任务开始前已有的未提交改动；没有将它们打包提交或部署。上线需遵循根 AGENTS.md：提交并推送 main、干净工作树且 HEAD==origin/main 后，才从 factory-cloud 执行 `npm run deploy`。
- 先更新/验证本地模拟器，再发布工厂线上入口；在当前录制自然完成之后安排需要的服务重启。
- 本次不涉及 GeeLark，不做账号或发布策略调整，不改变随机音频轮换。
