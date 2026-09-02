# Current State

Updated: 2026-09-02

## Platform

- Local Factory serves its authenticated UI on port 3010 by default. Logged-in admins land on `/` business hub.
- The workspace UI is now a light paper studio: warm cream background, ink text, olive/lime accents, 236px sidebar. Operational pages load `theme-ops.css` last so hardcoded dark panels, forms, and tables flip to the same light surfaces.
- The product is split into three business lines: mid-form video templates, novel promotion, and psychology. Official TikTok API is the primary publish/data channel; GeeLark pages remain as an explicit backup group.
- Reddit, psychology, Schulte, quiz, analytics, GeeLark publishing, and operations-brain modules are present.
- The mid-video workbench now includes `/quiz`: a configurable 6–9 question, three-choice paper quiz with dense multi-question framing, single-line auto-fit question titles, a red-marker underline followed by a hand exit, a hand-free 5-to-1 countdown, green answer ticks, built-in marker/tick/reveal sound effects, fast viewport scrolling, Chinese/English starter banks, local Remotion rendering, and Cloudflare-to-local-worker queue support. Missing built-in background music automatically falls back to sound-effects-only rendering instead of failing the job.
- The mid-video workbench now includes two psychology templates: `/psychology-collage` for 60–120 second paper-collage narratives and `/psychology-target-2` for 12–20 second interactive tests. Target 2 defaults to one-shot local Kokoro English narration, routes Chinese narration to one ElevenLabs timestamp request, and drives sentence captions plus SVG entrance/exit timing from measured audio. Generated MP4 and contact sheets remain in local `outputs` for review and are not uploaded to cloud storage.
- Runtime output and queue data use configured work and output directories.
- TikTok AI Tool is maintained as a separate hosted subproject.
- Official TikTok authorization is hosted by TikTok AI Tool. Local Factory's `/tiktok-connections` page stores only the hosted bridge URL/API key and lists accounts that completed authorization successfully.
- Local Factory contains no legacy connector, destination PostgreSQL, or fallback path. It reads authorized accounts, videos, and private metrics only through the hosted bridge API.
- Official novel operations no longer send full second-by-second curves to DeepSeek. Local rules score every video; the model only receives rewrite-eligible losers plus a compact scoreboard, then SOL reviews that slim packet. GeeLark/third-party operations keep the previous backup path.
- Novel AI Operations still reads up to 100 recent synchronized videos per selected account from the official hosted bridge across a 30-day private-data window. Curves stay in the local archive for operators; they are not replayed to the model every night. Bridge failures remain non-blocking and publishing continues to use the existing safety controls.
- Novel AI Operations can now turn evidence into production assets. It selects only real entries from the local paired novel-script/audio library, diagnoses the opening and retention loss, rewrites up to three complete narrations, calls ElevenLabs, records the rewritten script and evidence beside the generated audio, and copies the MP3 into the operator-selected audio directory. Individual TTS failures are recorded on the reviewable plan without discarding the rest of the plan.
- Administrators can open the paired novel script/audio library directly from the canonical sidebar. Existing administrator accounts receive the module through a one-time sidebar migration on the next service restart.
- `/novel-library` now defaults to the book catalog. Create and edit are separate pages. Each platform keeps its own featured list (set when creating/editing) and historical-hit list (auto-ranked from matched video plays, top 50 with at least 200 views).
- Novel effects are split by channel. `/novel-effects` is official API only. GeeLark third-party novel effects live at `/geelark-novel-effects` under the GeeLark backup group. The two sources are never mixed.
- `/novel-rewrite` is the manual rewrite workspace. The book list has a 改写 button that opens that novel. Saved versions stay under the novel, show up in novel effects, and appear in `/rewrite-records` next to official-operation rewrites.
- Cloud novel-opening jobs persist their full bilingual variants and the rewrite page automatically resumes the current user's latest job for that novel for 24 hours, so a timeout or page refresh does not force duplicate generation.
- `/novel-library` and `/novel-effects` paginate book/result cards in groups of 20. Official effect reads omit full source chapters, fetch independent datasets in parallel, and return only the current or viewed result rows to keep the hosted pages responsive.
- The sidebar module is now `小说内容`: the first-level entity is the canonical novel source, and its child records are generated script/opening variants, paired local audio, and matched TikTok video performance. Existing audio records are imported as unassigned scripts until an operator links them to a novel; AI rewrites inherit their parent script's novel relationship.
- Novel marketing generation automatically stores the submitted source as a novel and its five selected outputs as script variants. The operation brain receives the same novel/script hierarchy, so later evidence-based rewrites can be traced back to the original novel rather than analyzed as unrelated audio files.
- Novel AI Operations creates one standard Reddit automation workflow from one selected novel audio directory and one asset group or video directory. It uses the currently saved Reddit subtitle, deduplication, queue, retry, scheduling, publishing-copy, and GeeLark safety settings without generating alternate recipes or variants.
- Novel AI Operations ranks matched novel audio by views, median, low-view rate and recent trend. New plans pass that ranking to the actual Reddit generator: strong audio is prioritized, weak audio is downgraded when alternatives exist, and roughly one-third of selections remain exploratory.
- Official novel operations now persist an immutable experiment chain from source script/audio to each AI-derived script/audio version. Eligible experiments are evaluated once at 24 hours, 72 hours, and 7 days against their baseline using retention and watch-quality evidence; the original script is never overwritten.
- Experiment results feed a persistent success/failure pattern library. Patterns remain `testing` until sufficient evidence exists, then automatically become `promoted` or `demoted` with an explicit score, confidence, and evaluation count. SOL receives these patterns as historical evidence while the deterministic diagnosis remains the rewrite gate.
- The SOL execution path is now model-provider based. `codex-sdk` remains the default; a future OpenAI-compatible third-party endpoint can be selected with `OPERATION_MODEL_PROVIDER=openai-compatible`, `OPERATION_MODEL_ENDPOINT`, `OPERATION_MODEL_API_KEY`, and optional `OPERATION_MODEL_HEADERS_JSON` without changing operation-brain business logic.
- Novel AI Operations has a configurable 1-30 day operating cycle, defaulting to 7 days. The cycle starts only after automation is enabled with at least one account group, shows its remaining days in the UI, and automatically disables both scheduled analysis and automatic task creation at expiry. Existing queued tasks are not cancelled. Re-enabling starts a fresh cycle.
- Novel AI Operations has an independent account-judgment reset baseline. Clearing judgments keeps historical analytics intact but excludes earlier videos, private metrics, and plans from subsequent account-stage decisions until new post-reset data arrives.
- The novel operation keeps organic views as the sole optimization target. AI may diagnose account stages and adjust post timing, while video-generation settings remain operator-controlled. Strategy generation remains reviewable, and task creation still depends on the existing automatic-task switch and safety limits.
- Reddit publishing offers two explicit providers. GeeLark remains the default and keeps its existing route; administrators can alternatively select the TikTok official API, read hosted authorized accounts, upload generated videos to the publishing hub, and create scheduled batch tasks. Once the hosted batch is accepted, Local Factory marks the task as `已提交发布中台` and stops tracking it. Signal Desk exclusively owns scheduling, TikTok submission, final-status polling, retries, video IDs, and failure handling.
- Local Factory now separates local publishing records by provider. The existing `发布记录` view shows only GeeLark/local publishing records, while administrators have a standalone `官方 API 发布记录` view for successful handoffs to Signal Desk. Official records retain account, file, planned time, local task ID and hosted batch IDs for later analytics matching, but deliberately do not duplicate Signal Desk final-status tracking.

## Project Coordination

- Official API result ingestion is a separate daily Local Factory job and does not change the legacy third-party analytics schedule. It runs at 08:30 Asia/Shanghai by default, queries only records whose planned publish date is before the current Beijing calendar date, groups requests by Signal Desk batch ID, and writes final status, TikTok video ID, actual publish time and stored video details back to the local publish record. Future-dated tasks are not queried early; missing details retry on later daily runs and unresolved records require review after seven days. Signal Desk bridge calls are serialized with a configurable 650 ms interval so larger account sets do not burst the bridge rate limit.
- Official TikTok long-term analytics history uses indexed SQLite at `D:/localfactory-data/work/official-tiktok-history/official-history.sqlite`. Account/day and video/day snapshots are stored as separate rows, while legacy daily JSON files are imported once and retained as backups.
- The local authorized-account detail now mirrors the hosted account view: profile totals, gender, age, country/region, city, audience activity, a direct all-videos entry, and daily account-play history.
- The local account-video list now shows the hosted video fields (cover, caption, ID, publish time, duration, engagement, watch-time, completion, and reach). Each row opens a full retention detail view with traffic source, audience distributions, second-by-second retention, and daily play-history snapshots.

- `AGENTS.md` defines shared working and handoff rules.
- Project Hub is the shared project registry and cross-chat handoff memory.
- Project Hub keeps project objectives, module boundaries, active state, and handoff records. It no longer creates or runs subproject Agents.
- Existing rendering, publishing, and operations queues remain independent from Project Hub records.

## Safety

- Project Hub is read-only context storage and does not execute code or call external services.
- API keys and credentials must not be written to documentation or Git.
- Publishing actions remain behind existing task safety and GeeLark controls.
# TikTok 官方数据本地历史归档（2026-08-12）

- Local Factory 每天北京时间 08:30 从 Signal Desk 读取全部官方授权账号与每个账号最近 100 条视频。
- 每天的账号、视频和完整接口字段写入 `workDir/official-tiktok-history/YYYY-MM-DD.json`；当前 `workDir` 为 `D:/localfactory-data/work`，因此长期数据不占用 C 盘。
- 同一天手动重跑覆盖当天快照，不同日期永久保留，支持账号与单视频历史变化查询。
- 管理员侧边栏的官方数据入口现为 `授权账号`，并拆分为账号列表、账号详情与播放历史、所选账号视频、单视频历史变化四个页面；四个页面继续读取同一份本地 SQLite 归档并支持手动同步。
- 线上 Signal Desk 的官方日快照只保留 30 天；长期历史以本地 D 盘归档为准。
