# Psychology Viral Recreation: Infrastructure Cleanup

## Goal

Remove the unnecessary Docker and CI deployment setup requested by the user, while preserving the requested storyboard, image, narration and review functionality.

## Decisions

- Removed the Cloudflare Container class, Python yt-dlp server, Dockerfile, Durable Object binding/migration and `@cloudflare/containers` dependency.
- Removed the GitHub Actions production deployment workflow. Restored the unrelated hook-card test changes made only for that CI attempt.
- Uninstalled the Docker Desktop application installed for this task.
- Kept the psychology recreation workflow, scene parser, Z-Image/ElevenLabs generation, private review assets and review UI.
- The retained downloader uses an existing TikTok CDN HTTPS file URL from `videoData.videoFileUrl` with redirects disabled. It does not pretend a TikTok webpage is a media file.
- Records without that file URL fail before creating a job or spending provider credits. No new API key or external download service was configured.

## Files changed

- Deleted `.github/workflows/deploy-factory.yml`, `factory-cloud/src/tiktok-downloader-container.js`, and `factory-cloud/tiktok-downloader/` tracked files.
- Removed container configuration, exports and npm dependency from `factory-cloud/wrangler.jsonc`, `src/entry.js`, `package.json` and `package-lock.json`.
- Updated `factory-cloud/src/psychology-recreation-workflow.js`, `psychology-peer-production.js` and their tests to use existing file URLs and reject page-only jobs.
- Restored `scripts/novel-video-badge.test.js` to the original Windows renderer test.
- Corrected `docs/CURRENT_STATE.md` so the undeployed recreation implementation is not described as live.

## Verification

- Full Windows test suite: 300/300 passed with zero skipped tests. JavaScript syntax and git whitespace checks passed.

- Focused workflow and submission tests cover temporary download, full mocked analysis/image/audio flow, deletion of the source, missing file URLs, unsafe hosts and HTML responses.
- Cloudflare read-only inspection: no Containers exist; only the existing `factory-gemini-video-analysis` and `factory-peer-photo` workflows exist.
- Current production deployment remains `8740fae8-a9bd-41cc-969a-e543cf6227d0`. No deployment was performed during cleanup.
- Docker Desktop uninstaller returned success.

## Unfinished work

TikTok webpage-to-file URL resolution has not been implemented. The recreation feature has not been deployed or verified against a live TikTok video. Do not reinstall Docker or reintroduce auto-deploy to address this gap.

## Recommended next step

Choose a simple webpage-resolution method before deploying the retained recreation feature. Existing video analysis remains available online.
