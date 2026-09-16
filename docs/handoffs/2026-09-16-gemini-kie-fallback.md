# Gemini 视频分析 Google→Kie 自动兜底

## Goal

让 Factory 视频分析默认使用免费的 Google 官方 gemini-3.8-flash；Google 出现限流、高负载或 5xx 临时故障时，自动切换到 Kie 的 gemini-3-8-flash-openai 付费接口。

## Decisions

- Google 官方仍是默认服务商，模型分析最多调用三次，间隔 10 秒和 20 秒。
- 只有 429、5xx、high demand、temporary、overloaded 或 unavailable 等临时故障会触发 Kie；400 参数错误和内容拦截直接返回，避免无意义付费。
- Google Files API 上传或状态读取出现临时故障时也允许切换 Kie。
- Kie 通过一小时有效的 HMAC 签名 URL 读取当前 R2 视频；URL 不需要登录、不可枚举、过期失效，任务结束后 R2 文件立即删除。
- D1 记录实际服务商和 Kie 返回的积分消耗；前端展示 Google 官方或 Kie 兜底、token 和积分。
- Kie 密钥继续使用现有 Cloudflare Secret KIE_API_KEY，没有写入代码或文档。

## Files changed

- factory-cloud/src/gemini-video-workflow.js
- factory-cloud/src/gemini-video-client.js
- factory-cloud/src/kie-gemini-video-client.js
- factory-cloud/src/gemini-video-source.js
- factory-cloud/src/gemini-video-analysis.js
- factory-cloud/src/index.js
- factory-cloud/migrations/0024_gemini_video_provider.sql
- public/ai.html
- public/ai.js
- Focused tests and Factory test registration.

## Tests performed

- Video fallback focused suite: 12 passed.
- Workflow regression proves three Google high-demand responses lead to a signed Kie video request and persist Kie result, tokens, credits, and provider.
- Signature tests cover valid private R2 streaming, tampered signatures, and expiration.
- Google 400 responses remain permanent and do not become transient fallback errors.
- Full Factory suite: 291 passed.
- git diff --check passed.
- Production migration 0024 applied; health check passed; the signed video route rejected an invalid signature with 401. Deployed Worker version: 8740fae8-a9bd-41cc-969a-e543cf6227d0.

## Unfinished work

- Production deployment is complete. A naturally triggered real-video Kie fallback will be visible on the record as “Kie 兜底”; automated workflow coverage already verifies the failover path.

## Recommended next step

Submit a real video from AI 工作台. The record label shows whether Google completed it or Kie handled the fallback.
