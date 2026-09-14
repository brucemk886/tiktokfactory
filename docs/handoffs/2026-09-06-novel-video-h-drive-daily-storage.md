# Novel video H-drive daily storage

## Goal
Save new novel video recordings and final videos in a dedicated H-drive directory with daily subfolders.

## Decisions
- Root: `H:/小说推文视频`. Raw: `原始录制/YYYY-MM-DD`; final: `成片/YYYY-MM-DD`; intermediates: `临时合成/YYYY-MM-DD`. Dates use Asia/Shanghai.
- Updated local `config.json`: outputDir, novelOutputDailyFolders=true, novelRenderWorkDir. Updated simulator user settings: clipsDirectory and dailyClipFolders=true. Existing other settings preserved.
- Existing D-drive videos are not moved or deleted. The H-drive final root registers the old output directory in `.output-storage.json` so preview and publishing can still resolve historical filenames.
- Metadata and subtitle caches retain their existing work directory. Sequential recording/composition remains unchanged.

## Files changed
- scripts/output-storage.js and scripts/output-storage.test.js: dated and registered legacy output resolution with path checks.
- scripts/reddit-mix-job.js: daily final and intermediate directories; persisted outputPath.
- scripts/server.js, scripts/auto-task-manager.js, scripts/publish-service.js: resolve dated/legacy output files.
- scripts/minecraft-recording-smoke.js: dated outputs and optional H-drive fixture root.
- Sibling minecraft repository: electron/recording-storage.cjs, electron/main.cjs, index.html, tests/recording-storage.test.mjs. Raw writers use daily directories; validation uses the root and recognizes pending capture paths.
- docs/CURRENT_STATE.md and this handoff.

## Tests performed
- Focused factory/output/publishing/worker/recording regressions: 36/36 passed. Publishing used mocks; no live publishing APIs called.
- Simulator npm run build passed.
- Synthetic sequential smoke ran on H drive: four requests, one skipped item, three independently composed videos; simulated system failure stops task. Output durations, audio stream and full decode verified.
- Evidence: `H:/小说推文视频/临时合成/2026-09-06/验证/minecraft-sequential-smoke-1788684028983/verification.json`.
- git diff --check passed before documentation update.

## Unfinished work
- No service restart or deployment. Existing factory processes must reload code/config while idle. Simulator settings apply on its next startup.
- Actual live Minecraft capture remains unverified; smoke used synthetic footage and cached captions.
- Both repositories contain unrelated uncommitted work; preserve it. Online deployment has not been performed.

## Recommended next step
Restart the local factory only when idle, then validate one real template-2 task with Minecraft running in the required singleplayer environment.

## Restart completed (2026-09-06)
User authorized restart. No render child processes or active scheduled tasks were present; running job files were stale historical records (newest over two days old). Restarted server PID 50260 via its existing watchdog; replacement PID 48784 served HTTP 200 on port 3010 with no watchdog error. New local config is loaded. No cloud deployment or live Minecraft capture test was performed.
