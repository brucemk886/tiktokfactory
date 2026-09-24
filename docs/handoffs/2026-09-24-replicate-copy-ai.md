# Replicate (Claude) for copy-library rewrites

## Goal
Let the factory write rewrites itself with Claude Sonnet 5 via Replicate, with a model picker on the single "AI 生成" draft and a batch "批量新增改写" action on the copy library.

## Decisions
- `factory-cloud/src/replicate.js`: `replicateText` creates a prediction with `Prefer: wait=60`, polls `urls.get` every 1.5 s up to 120 s, joins the streamed `output` array. Needs secret `REPLICATE_API_TOKEN` (503 until set). `effort` defaults to `low` (no thinking).
- `COPY_MODELS` in `psychology-copy-generation.js`: `claude-sonnet-5` (anthropic/claude-sonnet-5, $2/$10 per M tokens on Replicate), `claude-opus-4.7`, `claude-haiku-4.5`, `deepseek-flash` (existing key). The API keeps DeepSeek as default when no model is passed; the page defaults to Sonnet 5.
- The shared prompt now carries the TikTok copywriting brief (micro-moments, validate then reassure, save-worthy close).
- `POST /api/psychology-creative/copies/generate-batch?sourceId&model&count(1–5)`: one model call returns `count` versions with distinct angles; each passes `validateCopyDraft`, `checkRewrite` and `checkSharedLines`, and is saved enabled as `ai-<model>-<hash>`; failing versions are returned in `skipped`. Resending the same output is a no-op.
- Page: `#batchModel`, `#batchCount`, `#batchRewriteBtn` in the selection bar (two posts at a time, progress in the status line); `#variantModel` next to "AI 生成".

## Tests
Factory suite 658/658 (Replicate wait/poll/fail/timeout/missing key; model selection; batch save + gate skips + idempotent resend; page batch request per source).

## Next
- Set `REPLICATE_API_TOKEN` (`npx wrangler secret put REPLICATE_API_TOKEN` in factory-cloud).
- Trial 20 posts on Sonnet 5, compare with Opus 4.7 before a full run.
