# 中视频统一 TikTok 官方发布

日期：2026-09-02

## 本次范围

- 舒尔特批量生成不再读取 GeeLark 云手机，改为读取 `mid-video` 项目内已分配的 TikTok 官方账号；自动发布任务携带 `provider: official`、`connectionIds` 和轮转排期。
- 测试题页面增加官方账号、分组、文案和排期设置；渲染任务同时输出 `results` 数组，使 Cloudflare 本地工人能在渲染后直接进入统一官方上传器。
- 播客模板的成片发布面板改为 TikTok 官方账号和 `/api/official-tiktok/publish`，发布记录入口改到官方发布记录。
- `/mid-video-publish` 只读取 `generate`、`schulte`、`quiz` 三类中视频成片，避免混入小说或心理学任务。
- Cloudflare 队列在入队前验证项目分组、账号归属与 `video.publish` scope，并用服务端账号信息覆盖前端提交的账号元数据。

## 边界

- Local Factory 负责渲染、读取本地成片、上传素材和创建 Signal Desk 批次；批次被接受后，由 Signal Desk 负责最终排期、发布、轮询和重试。
- GeeLark 路由仍为小说/第三方备用业务保留，但当前已上线的中视频页面不再调用 GeeLark 发布接口。
- 心理学和俄罗斯方块仍在其他未合并开发分支中；它们合入主分支时应复用本次 `provider: official` 适配层，不能重新增加 GeeLark 发布入口。
- 当前正在运行的本地服务与工人没有在本次改造中重启；部署线上静态页面和 Worker 后，本地工人需要在现有任务结束后重启一次，才会加载测试题结果格式等本地代码更新。

## 验证

- `node --check` 已覆盖本次触及的浏览器、工人和 Cloudflare JavaScript。
- `factory-cloud/npm test`：150/150 通过。
- 新增 `scripts/mid-video-official-publish.test.js`，持续防止中视频页面重新引用 `/api/geelark/phones` 或 `/api/geelark/publish`。
