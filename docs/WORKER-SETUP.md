# 第二台工人机搭建

目标：新机器只做「拉渲染任务 → 出片 → 把自己出的片提交官方发布」，不产生别的机器看不到的状态。主机（`windows-local`）继续负责音频生成、素材索引、目录分类等。多工人的约束见 `PIPELINE.md` 2.6。

下面把主机叫 **A**（现在的 `windows-local`），新机叫 **B**。

## 0. 前置

| 项 | A 上的现状 | B 上要做到 |
|---|---|---|
| Node | v22.16.0 | 同大版本（22.x） |
| ffmpeg / ffprobe | 8.0.1 gyan full build，在 PATH 里 | 同样在 PATH 里；有 NVIDIA 显卡就装带 NVENC 的 full build，没有也能跑（CPU 编码，慢） |
| 磁盘 | 系统 D: 数据、F: 素材 | 出片目录所在盘剩余 ≥ 20GB（排产会检查） |
| 网络 | — | 能访问 `factory.tiktokaitool.com`、`tiktokaitool.com`、`api.elevenlabs.io` |

## 1. 代码

```powershell
git clone https://github.com/brucemk886/tiktokfactory.git D:\cursor\localfactory
cd D:\cursor\localfactory
npm install
```

## 2. `config.json`

从 A 把 `D:\cursor\localfactory\config.json` 原样拷到 B 同一位置（里面有 ElevenLabs 等密钥，不进 git）。路径保持一致最省事：

- `workDir`: `D:/localfactory-data/work`
- `outputDir`: `D:/localfactory-data/outputs`
- `assetLibraryRoot`: `F:/视频素材`
- `audioLibraryRoot`: `F:/音频目录`

盘符不一样就改这四个键，但**素材组文件夹名必须和 A 一致**（素材组 id 就是文件夹名）。

## 3. 素材与音频

- `F:\视频素材`（约 70GB）：一次性拷到 B 的同一路径。之后 A 加新素材要同步过去，不然 B 接到该素材组的任务会失败。
- `F:\音频目录`（约 1.4GB）+ `D:\localfactory-data\work\audio-library\`（索引 + 约 0.8GB 文件）：**会持续变化**（A 生成新的小说音频），要定时同步。在 B 上建计划任务，每 10 分钟从 A 的共享拉一次：

```powershell
robocopy \\A主机名\音频目录 F:\音频目录 /MIR /R:1 /W:5 /NP /LOG+:D:\localfactory-data\work\sync-audio.log
robocopy \\A主机名\audio-library D:\localfactory-data\work\audio-library /MIR /R:1 /W:5 /NP /LOG+:D:\localfactory-data\work\sync-audio.log
```

（先在 A 上把 `F:\音频目录` 和 `D:\localfactory-data\work\audio-library` 共享出来。）同步窗口内 B 接到刚生成音频的任务会报「本机音频目录里找不到这些小说音频」，任务失败后在云端重试即可；要完全避免就把间隔缩到 5 分钟。

## 4. `work` 目录

```powershell
New-Item -ItemType Directory -Force D:\localfactory-data\work, D:\localfactory-data\outputs
```

从 A 的 `D:\localfactory-data\work` 拷这些过来：

| 拷 | 说明 |
|---|---|
| `asset-library\groups.json` | 素材索引（约 48MB，里面是 F:\ 的绝对路径，路径一致才能直接用；不一致见下面「重建索引」） |
| `audio-library\`（整个目录） | 第 3 步的同步已经覆盖 |
| `caption-cache\`（整个目录） | 字幕识别缓存，省 ElevenLabs 费用，可选 |
| `official-tiktok-analytics-settings.json` | 中台地址 + API key，B 提交发布要用 |
| `reddit-mix-settings.json` | 可选，有它 B 也会往云端 sync 同一份 |

**不要拷**：`publish-records.json`（150MB，两份都会往云端 sync）、`scheduled-tasks\`、`jobs\`、`asset-library\usage.json`、`factory-*.json`、各类 `*.log`、`tmp-*`。

新建 `D:\localfactory-data\work\factory-cloud-worker.json`：

```json
{
  "url": "https://factory.tiktokaitool.com",
  "token": "<和 A 的 factory-cloud-worker.json 里同一个 token>",
  "workerId": "windows-2",
  "pollMs": 60000,
  "syncMs": 300000,
  "renderConcurrency": 2,
  "publishConcurrency": 1,
  "renderJobTypes": ["auto-task", "reddit-mix"]
}
```

- `workerId` 必须和 A 不同，定了就别改。
- `renderJobTypes` 白名单让 B 只接混剪任务，不接 `audio-generate`、`asset-reindex`、`folder-classify` 这类会在本机落状态的任务。以后 B 也备齐了别的素材，再往里加。
- `renderConcurrency` 看 CPU/显卡：有 NVENC 可以 3–4，纯 CPU 建议 2。

### 重建索引（只有路径和 A 不一致时才做）

```powershell
cd D:\cursor\localfactory
node -e "import('./scripts/asset-library.js').then(m => { for (const g of m.discoverAssetLibraryGroups(process.cwd(), 'F:/视频素材')) { const r = m.reindexAssetGroup(process.cwd(), g.id); console.log(g.id, r.indexed) } })"
```

## 5. 启动

先手动跑一遍看日志：

```powershell
cd D:\cursor\localfactory
node scripts/server.js
```

应看到 `工厂云工人已接入：https://factory.tiktokaitool.com  worker=windows-2  渲染并发=2 发布并发=1`。没看到「未配置工厂云工人」之类的提示、也没有报错，就 Ctrl+C，装守护：

```powershell
npm run watchdog:install
```

这会注册计划任务 `LocalFactoryWatchdog`（开机自启），10 秒内拉起 `server.js`。确认：`D:\localfactory-data\work\factory-watchdog.json` 里 `heartbeatAt` 在走、`serverPid` 对应的进程存在。

## 6. 验证

1. 云端建一条小任务（2 条视频），看哪台接了：B 的控制台会打 `接到工厂云任务 …`；云端任务进度接口（`publicJob`）也返回 `workerId`。
2. B 出片后应自己提交发布（`已出片 N 条，已排队官方发布` → 发布通道接到 `official-publish`）。如果发布任务被 A 接走并报「视频文件不存在」，说明云端还没发新版（`renderWorkerId` 亲和），先 `npm run deploy`。
3. 5 分钟后云端 `factory-worker-status` 的 `workerId` 会在两台之间跳，是正常的（只记最后一次 sync）。

## 7. 日常

- 重启 B 的工人：`Stop-Process` 掉 `server.js` 的 node 进程，守护 10 秒内拉起。
- 改了 `config.json` 或 `factory-cloud-worker.json` 要重启工人才生效。
- B 长时间下线时，它渲染完还没发布的任务会一直排队等它（不会被 A 抢走）；要放弃就在云端把任务取消。
- 排障看 `work\factory-watchdog.log`、`work\server-crash.log`，其余同 `PIPELINE.md` 第 7 节。
