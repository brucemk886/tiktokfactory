# 第二台工人机搭建

模型：**每台机器完全独立**——自己的素材、自己的音频、自己的配置，任务在创建时指定给哪台跑。机器之间不需要互通、不需要传任何文件，只要都能连 `factory.tiktokaitool.com`。

下面把现在的主机叫 **A**（`windows-local`），新机叫 **B**。

## 工作方式

- 建任务页（`/tasks`）出现「执行机器」下拉（登记了 ≥2 台机器时才显示）。选了 B，任务只会下发给 B；素材组、音频文件夹列表也只显示 B 推送上来的。
- B 配置里 `assignedOnly: true`：**只接指定给它的任务**，不会去抢没指定机器的任务（那些还是 A 接）。
- 每台机器推送的素材组/音频文件夹带 `workerId`，云端按机器合并保存，不会互相覆盖。
- B 出的片由 B 自己提交官方发布（发布任务绑定渲染机器）。
- B 需要的共享密钥（中台 API key、ElevenLabs key、混剪默认设置）由工厂云直接下发（`GET /api/worker/bootstrap`），**唯一要手填的是工厂的 `WORKER_TOKEN`**——那是工厂的凭证，每台工人都用它，不是 A 的东西。
- 素材使用率只在各台本机 `localhost:3010/asset-usage` 查看，工厂云不再提供该页。

## 1. 在 B 上准备素材

- 视频素材放成 `<素材根>\<素材组名>\*.mp4`，一级子文件夹 = 一个素材组（例如 `E:\视频素材\minecraft-01\`）。
- 音频放成 `<音频根>\<平台>\<小说>\*.mp3`（或直接一级文件夹放音频）。
- 出片盘剩余 ≥ 20GB。

## 2. 拿工厂 token

`WORKER_TOKEN` 是 Cloudflare 上 `tiktok-factory` 这个 Worker 的 secret。查看：Cloudflare 后台 → Workers → tiktok-factory → Settings → Variables；或在 A 上 `D:\localfactory-data\work\factory-cloud-worker.json` 里的 `token`（同一个值）。

## 3. 在 B 上一键搭建

```powershell
# 管理员 PowerShell；仓库还没拉的话脚本会自己 clone 到 D:\cursor\localfactory
Invoke-WebRequest https://raw.githubusercontent.com/brucemk886/tiktokfactory/main/scripts/worker-setup/setup-worker.ps1 -OutFile $env:TEMP\setup-worker.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\setup-worker.ps1 `
  -Token <WORKER_TOKEN> `
  -WorkerId worker-2 `
  -Label "老家那台" `
  -AssetRoot E:\视频素材 `
  -AudioRoot E:\音频目录
```

可选参数：`-DataDir D:\localfactory-data`、`-RepoDir D:\cursor\localfactory`、`-RenderConcurrency 2`（有 NVENC 可以 3–4）、`-ElevenLabsKey` / `-DeskApiKey`（想用别的 key 时覆盖云端下发的）、`-SkipInstallWatchdog`。

脚本做的事：

1. 缺 Node / Git / ffmpeg 就用 winget 装。
2. clone（或 `git pull`）仓库，`npm install`。
3. `bootstrap-worker.mjs`：用 token 向工厂云拿共享密钥；从仓库的 `config.example.json` 生成 `config.json`（路径换成 B 的，填 ElevenLabs key）；写 `work\factory-cloud-worker.json`（`workerId=worker-2`、`assignedOnly=true`、`renderJobTypes=["auto-task","reddit-mix"]`）、`work\official-tiktok-analytics-settings.json`（中台地址 + key）、`work\reddit-mix-settings.json`。
4. `index-and-push.mjs`：给素材根下每个文件夹建索引（逐条 ffprobe，几十 GB 约十几分钟），再把素材组和音频文件夹推到云端。
5. `npm run watchdog:install` 注册计划任务 `LocalFactoryWatchdog`，等 3010 端口起来。

看到 `Worker is up` 即可。B 的日志会打 `工厂云工人已接入：… worker=worker-2`。如果第 3 步打出「缺失」警告（云端没配某个 key），加 `-ElevenLabsKey` / `-DeskApiKey` 重跑。

## 4. 建任务

打开 `https://factory.tiktokaitool.com/tasks`，「执行机器」选 `worker-2`，素材组和音频文件夹就是 B 的。其余和以前一样。

任务卡片上会显示「执行机器 worker-2」。B 下线超过 10 分钟，下拉里会标「离线」，任务照样能建，排队等它上线。

## 5. B 日常

| 事 | 做法 |
|---|---|
| B 加了新素材/音频 | 在 B 上 `npm run worker:index`（重建索引并推送，逐条 ffprobe 较慢）；只推送不重建索引：`npm run worker:push`（PowerShell 会吞掉 `npm run … -- --flag` 里的 `--`，所以不要用 `--skip-index` 的写法） |
| 重启工人 | `Stop-Process` 掉 `server.js` 的 node 进程，守护 10 秒内拉起 |
| 改了 `config.json` / `factory-cloud-worker.json` | 重启工人才生效 |
| 换了 token / 密钥 | 重跑 `node scripts/worker-setup/bootstrap-worker.mjs --token … --worker-id worker-2 --asset-root … --audio-root …`（会重写配置，不动素材索引），然后重启工人 |
| 放弃 B 还没跑的任务 | 云端任务卡片「停止」 |
| 排障 | `work\factory-watchdog.log`、`work\server-crash.log`，其余同 `PIPELINE.md` 第 7 节 |

## 6. 验证清单

1. `GET https://factory.tiktokaitool.com/api/workers`（管理员登录后）能看到两台，`online: true`。
2. `/tasks` 出现「执行机器」下拉；切到 `worker-2` 时素材组列表变成 B 的。
3. 指定 B 建一条 2 条视频的小任务：A 的日志里**不该**出现 `接到工厂云任务`，B 应接到；出片后 B 自己接 `official-publish`。
4. 不指定机器（或 A 单机时）建任务，B 不接。
