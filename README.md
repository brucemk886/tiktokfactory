# Local Factory

本地视频内容生产与发布工具，当前包含 Reddit 混剪、视频素材切割、素材使用率、自动任务、GeeLark 发布、发布记录和 TikTok 数据分析。

## 快速开始

```powershell
cd C:\Users\111\Documents\Codex\2026-06-30\z
npm.cmd run start
```

打开：

```text
http://localhost:3010/tasks
```

## 完整使用手册

请阅读 [Local Factory 本地内容工厂使用手册](docs/本地内容工厂使用手册.md)。

手册包含：

- 推荐的日常生产流程
- 素材切割与素材组索引
- Reddit 视频生成与字幕缓存
- 自动任务、账号分配和发布时间规则
- GeeLark 发布安全、防重复和人工重试
- 自动清理、备份迁移和常见错误处理

## 安全提醒

不要分享 `config.json`，其中可能包含 ElevenLabs 和 GeeLark API 凭据。
