# Google Gemini 视频分析接入

## Goal

在 Factory 线上 AI 工作台接入 Google 官方视频理解能力，使用 `gemini-3.8-flash` 分析用户上传的视频并保留分析记录。

## Decisions

- 视频从浏览器流式写入 R2，不在 Worker 内存中缓冲。
- Cloudflare Workflow 异步上传 Google Files API、等待处理并调用 `gemini-3.8-flash`，避免长视频占住网页请求。
- 分析结果、状态、文件元数据和 token 用量写入 D1。
- Google 与 R2 临时视频在任务结束后清理；密钥只使用 Cloudflare Secret `GEMINI_API_KEY`。
- 功能仅供管理员使用，单文件上限 500 MB。

## Files changed

- `factory-cloud/src/gemini-video-analysis.js`
- `factory-cloud/src/gemini-video-client.js`
- `factory-cloud/src/gemini-video-workflow.js`
- `factory-cloud/src/index.js`
- `factory-cloud/src/entry.js`
- `factory-cloud/migrations/0023_gemini_video_analysis.sql`
- `factory-cloud/wrangler.jsonc`
- `public/ai.html`
- `public/ai.js`
- `public/module-pages.css`
- Focused tests and Factory test registration.

## Tests performed

- Focused Gemini route/client tests: 4 passed.
- Full Factory suite: 281 passed.
- Wrangler deployment dry-run: Worker, assets, D1, R2 and both Workflow bindings packaged successfully.
- JavaScript syntax and `git diff --check` passed.
- Production smoke test: a two-second MP4 returned the expected blue-frame description with 140 input and 10 output tokens; Workflow completed in 21 seconds and deleted both temporary files.

## Unfinished work

- Production currently has no `GEMINI_API_KEY` Cloudflare Secret. The UI reports the service as unavailable until the secret is added.
- A real paid-provider smoke test must run after that secret is configured.

## Recommended next step

Use AI 工作台 → 视频分析 with a real source video and a production analysis prompt.
