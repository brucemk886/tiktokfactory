# Business Hub and Local-Score Novel Ops

Updated: 2026-08-14

## Goal

Split Local Factory into three business lines, keep GeeLark as an explicit backup, and stop spending DeepSeek tokens on full official retention curves.

## Decisions

- `/` is the business hub. Podcast generation moved to `/podcast` and now sits under mid-form video.
- Sidebar groups are: 中视频, 小说推文, 心理学, 官方通道, GeeLark 备用.
- Official novel operations send only rewrite-eligible videos and a local scoreboard to the model. Full curves remain in the local archive.
- GeeLark operator, analytics, publish records, and scrape settings stay available and are labeled as backup.

## Files changed

- `scripts/sidebar-modules.js`
- `scripts/local-auth.js`
- `scripts/server.js`
- `scripts/operation-brain.js`
- `public/access.js`, `public/hub.html`, `public/hub.css`, `public/hub.js`, `public/mid-video.html`, `public/login.js`, `public/index.html`, `public/app.css`
- `docs/CURRENT_STATE.md`

## Tests performed

- `node --test scripts/sidebar-modules.test.js scripts/local-auth.test.js scripts/operation-brain.test.js`

## Unfinished work

- Mid-form templates still publish through their existing GeeLark panels until official API publish is wired per template.
- Psychology remains independent and does not yet share the official publish queue.

## Recommended next step

Run one official novel plan against a mapped script/audio library and confirm `scriptOptimizations` is populated without DeepSeek batch curve analysis.
