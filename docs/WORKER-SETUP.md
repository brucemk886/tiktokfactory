# 第二台工人机搭建

目标：新机器只做「拉混剪任务 → 出片 → 把自己出的片提交官方发布」，不产生别的机器看不到的状态。主机（`windows-local`）继续负责音频生成、素材索引、目录分类等。多工人的约束见 `PIPELINE.md` 2.6。

下面把主机叫 **A**（现在的 `windows-local`），新机叫 **B**。

## 一键方式（推荐，不拷视频素材）

B 不复制 70GB 素材，直接通过局域网只读共享读 A 的 `F:\视频素材` 和 `F:\音频目录`。A 新增的素材、新生成的音频，B 立刻可见，不用同步。要求两台机器在同一局域网，**有线千兆**（2 路并发渲染约 50MB/s 读流量，Wi-Fi 会卡）。

### A 上跑一次（管理员 PowerShell）

```powershell
cd D:\cursor\localfactory
git pull
powershell -ExecutionPolicy Bypass -File scripts\worker-setup\primary-share.ps1
```

做的事：把 `F:\视频素材`、`F:\音频目录` 只读共享为 `\\A\factory-videos`、`\\A\factory-audio`（只给当前登录账号）；打开「文件和打印机共享」防火墙、把公用网络改成专用；导出 seed 到 `D:\localfactory-data\worker-seed` 并共享为 `\\A\factory-seed`（含 `config.json`、素材索引、字幕缓存、中台密钥、工人 token，所以同样只给当前账号读）。

跑完它会打印 B 上要执行的那一行命令。

### B 上跑一次（管理员 PowerShell）

```powershell
powershell -ExecutionPolicy Bypass -File \\A主机名\factory-seed\worker-bootstrap.ps1 -WorkerId windows-2
```

B 的登录账号/密码和 A 不同时加 `-PrimaryUser 'A主机名\A的用户名' -PrimaryPassword 'A的登录密码'`（存进 Windows 凭据管理器，后台守护也能用）。

做的事，缺什么装什么：

1. Git、Node（装和 A 同版本的 22.x，从 nodejs.org 取 MSI，因为 winget 只剩 24）、ffmpeg（gyan full build，和 A 一样）。
2. `git clone` 到 `D:\cursor\localfactory`，`npm install`。
3. `scripts/worker-setup/apply-seed.mjs` 按 seed 生成：
   - `config.json`：密钥照抄，`workDir`/`outputDir` 落本机 `D:\localfactory-data`，`assetLibraryRoot`/`audioLibraryRoot` 指向 `\\A\factory-videos`/`\\A\factory-audio`，并写 `pathAliases`（`F:/视频素材` → 共享、`F:/音频目录` → 共享）。任务 payload 里 A 的绝对路径（如 `audioDir: F:\音频目录\0708`）在 B 上找不到时会按这个表改写。
   - `work\asset-library\groups.json`：A 的索引，路径前缀改成共享。
   - `work\factory-cloud-worker.json`：`workerId=windows-2`、`renderJobTypes=["auto-task","reddit-mix"]`、渲染并发 2。
   - 拷 `caption-cache`（省 ElevenLabs 识别费）、`official-tiktok-analytics-settings.json`、`audio-library\index.json`。
4. 启动 `server.js` 25 秒，确认日志里有 `worker=windows-2`，再 `npm run watchdog:install` 注册开机守护。

可选参数：`-Root`、`-DataDir`（默认 `D:\...`，B 没有 D 盘就改）、`-RenderConcurrency 3`（有 NVENC）、`-RenderTypes`、`-SkipInstall`、`-Force`（重写已存在的配置和索引）。

### 之后

- A 加了新素材组（`F:\视频素材` 下新文件夹并建了索引）：A 重跑 `primary-share.ps1` 刷新 seed，B 重跑 bootstrap 加 `-Force`。只是往已有文件夹里加视频不用动，B 用 A 的索引。
- A 生成了新音频：不用动，B 直接从共享读。
- 任务里用到 `F:\视频素材`、`F:\音频目录` 之外的绝对路径（例如 `D:\方块跑酷模拟器视频`、`F:\模板素材`）：B 找不到就任务失败。要支持就在 A 上 `New-SmbShare -Name factory-parkour -Path D:\方块跑酷模拟器视频 -ReadAccess <账号>`，B 的 `config.json` `pathAliases` 里加一行 `"D:/方块跑酷模拟器视频": "//A/factory-parkour"`，重启 B 的工人。
- B 的素材使用去重（`usage.json`）是自己一份，两台可能各抽到同一段素材，已知局限。
- 云端「本机工人在线」只显示最后 sync 的那台，会在两台间跳，正常。

## 手动方式（要把素材拷过去时）

不想走共享（比如两台不在一个局域网）就手动做，要点：

| 项 | A 上的现状 | B 上要做到 |
|---|---|---|
| Node | v22.16.0 | 同大版本 |
| ffmpeg / ffprobe | 8.0.1 gyan full build，在 PATH 里 | 同样在 PATH 里；有 NVIDIA 装带 NVENC 的 |
| 磁盘 | — | 出片目录所在盘剩余 ≥ 20GB |
| 网络 | — | 能访问 `factory.tiktokaitool.com`、`tiktokaitool.com`、`api.elevenlabs.io` |

1. `git clone https://github.com/brucemk886/tiktokfactory.git D:\cursor\localfactory && npm install`。
2. 拷 A 的 `config.json`，路径保持一致（`F:/视频素材`、`F:/音频目录`、`D:/localfactory-data/...`）。素材组文件夹名必须和 A 一致（素材组 id 就是文件夹名）。
3. 拷 `F:\视频素材`（约 70GB，一次性）；`F:\音频目录` + `work\audio-library`（约 2GB，**会持续变化**）用 robocopy 计划任务每 10 分钟同步：

```powershell
robocopy \\A\factory-audio F:\音频目录 /MIR /R:1 /W:5 /NP /LOG+:D:\localfactory-data\work\sync-audio.log
```

4. `work` 目录从 A 拷：`asset-library\groups.json`（路径一致才能直接用）、`audio-library\`、`caption-cache\`、`official-tiktok-analytics-settings.json`。**不要拷** `publish-records.json`、`scheduled-tasks\`、`jobs\`、`asset-library\usage.json`、`factory-*.json`、日志。
5. 新建 `work\factory-cloud-worker.json`（token 用 A 的同一个）：

```json
{
  "url": "https://factory.tiktokaitool.com",
  "token": "<A 的 token>",
  "workerId": "windows-2",
  "pollMs": 60000,
  "syncMs": 300000,
  "renderConcurrency": 2,
  "publishConcurrency": 1,
  "renderJobTypes": ["auto-task", "reddit-mix"]
}
```

6. `node scripts/server.js` 看到 `工厂云工人已接入 … worker=windows-2`，Ctrl+C，`npm run watchdog:install`。

## 验证

1. 云端建一条 2 条视频的小任务，B 的控制台会打 `接到工厂云任务 …`；云端任务进度接口也返回 `workerId`。
2. B 出片后应自己提交发布（`已出片 N 条，已排队官方发布` → 发布通道接到 `official-publish`）。
3. `D:\localfactory-data\work\factory-watchdog.json` 的 `heartbeatAt` 在走。

## 日常

- 重启 B 的工人：`Stop-Process` 掉 `server.js` 的 node 进程，守护 10 秒内拉起。改了 `config.json` / `factory-cloud-worker.json` 要重启才生效。
- B 长时间下线时，它渲染完还没发布的任务会一直排队等它（不会被 A 抢走）；要放弃就在云端取消任务。
- 排障看 `work\factory-watchdog.log`、`work\server-crash.log`，其余同 `PIPELINE.md` 第 7 节。
