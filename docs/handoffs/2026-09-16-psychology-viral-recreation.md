# Psychology Viral Recreation

## Goal

Replace the peer-hit template selector and local canvas queue with a cloud-only TikTok recreation flow that downloads the source, analyzes it, creates reviewable scene images and narration, and stops before composition.

## Decisions

- Public TikTok page URLs are downloaded by a dedicated Cloudflare Container running yt-dlp; no undocumented SnapTik endpoint is used.
- The downloader uses a fixed pool of three `basic` instances and sleeps after five idle minutes.
- Source video exists in R2 only while Gemini analyzes it. The shared Gemini workflow removes it immediately after analysis, and the recreation workflow repeats cleanup defensively on every exit.
- Google official Gemini 3.8 Flash remains primary and the existing Kie Gemini 3.8 Flash path remains the transient-error fallback.
- Parsed scene JSON is validated before any Z-Image or ElevenLabs charge.
- Scene generation continues after an individual image/audio failure and preserves completed materials for review.
- Generated images and audio remain private in R2 and are served through login- and owner-scoped routes with audio Range support.
- The first release ends at 素材待检查. It does not compose or publish a video.

## Files changed

- `scripts/psychology-recreation.js` and tests: grounded analysis prompt and strict storyboard parser.
- `factory-cloud/src/psychology-recreation-workflow.js` and tests: download, analysis, Z-Image, ElevenLabs, cleanup and review result orchestration.
- `factory-cloud/tiktok-downloader/`: yt-dlp container service.
- `factory-cloud/src/tiktok-downloader-container.js`, `src/entry.js`, `wrangler.jsonc`, `package.json`: Cloudflare Container and Workflow bindings.
- `factory-cloud/src/psychology-peer-production.js`, `src/jobs.js`: recreation submission, deduplication, private assets and local-worker exclusion.
- `public/psychology-peer-hits.html`, `public/psychology-peer-production.js`: voice selection and 爆款复刻 submission.
- `public/psychology-production.*`, `factory-cloud/src/sidebar.js`: review board and renamed navigation.

## Tests performed

- `npm test` in `factory-cloud`: all 297 tests passed in the final code state.
- Focused recreation tests cover strict scene parsing, TikTok host validation, streamed temporary R2 upload, end-to-end Google/Z-Image/ElevenLabs mocks, immediate source deletion, submission deduplication, owner-scoped asset access, audio Range reads and local-worker exclusion.
- `node --check` passed for new and changed JavaScript entry points.
- `python -m py_compile factory-cloud/tiktok-downloader/server.py` passed.
- `npx wrangler types --config wrangler.jsonc` accepted the Workflow, Container and Durable Object bindings.

## Unfinished work

- This host does not have Docker installed, so the Cloudflare Container image cannot be built and production deployment cannot complete here yet.
- Run the complete test suite once more after any final code changes, then commit and push `main` before deployment.

## Recommended next step

Install/start Docker Desktop on the deployment host, build/validate the container through the repository deployment command, push the tested commit to GitHub `main`, and deploy only with `npm run deploy` from `factory-cloud`.
