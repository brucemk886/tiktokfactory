# Current State

Updated: 2026-08-12

## Platform

- Local Factory serves its authenticated UI on port 3010 by default.
- Reddit, psychology, Schulte, analytics, GeeLark publishing, and operations-brain modules are present.
- Runtime output and queue data use configured work and output directories.
- TikTok AI Tool is maintained as a separate hosted subproject.
- Official TikTok authorization is hosted by TikTok AI Tool. Local Factory's `/tiktok-connections` page stores only the hosted bridge URL/API key and lists accounts that completed authorization successfully.
- Local Factory contains no legacy connector, destination PostgreSQL, or fallback path. It reads authorized accounts, videos, and private metrics only through the hosted bridge API.
- Novel AI Operations supports a full-data hybrid strategy route: DeepSeek V4 Flash processes every recent synchronized video and every available second-by-second retention/like point in bounded sequential batches, synthesizes the evidence, and SOL makes the final operating decision.
- Novel AI Operations reads up to 100 recent synchronized videos per selected account from the official hosted bridge across a 30-day private-data window. DeepSeek receives every retained video and every available curve point; SOL also receives the account profile and compact per-video hook, completion, average-watch, and largest-drop evidence. Bridge failures remain non-blocking and publishing continues to use the existing safety controls.
- Novel AI Operations can now turn evidence into production assets. It selects only real entries from the local paired novel-script/audio library, diagnoses the opening and retention loss, rewrites up to three complete narrations, calls ElevenLabs, records the rewritten script and evidence beside the generated audio, and copies the MP3 into the operator-selected audio directory. Individual TTS failures are recorded on the reviewable plan without discarding the rest of the plan.
- Administrators can open the paired novel script/audio library directly from the canonical sidebar. Existing administrator accounts receive the module through a one-time sidebar migration on the next service restart.
- The sidebar module is now `小说内容`: the first-level entity is the canonical novel source, and its child records are generated script/opening variants, paired local audio, and matched TikTok video performance. Existing audio records are imported as unassigned scripts until an operator links them to a novel; AI rewrites inherit their parent script's novel relationship.
- Novel marketing generation automatically stores the submitted source as a novel and its five selected outputs as script variants. The operation brain receives the same novel/script hierarchy, so later evidence-based rewrites can be traced back to the original novel rather than analyzed as unrelated audio files.
- Novel AI Operations creates one standard Reddit automation workflow from one selected novel audio directory and one asset group or video directory. It uses the currently saved Reddit subtitle, deduplication, queue, retry, scheduling, publishing-copy, and GeeLark safety settings without generating alternate recipes or variants.
- Novel AI Operations ranks matched novel audio by views, median, low-view rate and recent trend. New plans pass that ranking to the actual Reddit generator: strong audio is prioritized, weak audio is downgraded when alternatives exist, and roughly one-third of selections remain exploratory.
- Novel AI Operations has a configurable 1-30 day operating cycle, defaulting to 7 days. The cycle starts only after automation is enabled with at least one account group, shows its remaining days in the UI, and automatically disables both scheduled analysis and automatic task creation at expiry. Existing queued tasks are not cancelled. Re-enabling starts a fresh cycle.
- Novel AI Operations has an independent account-judgment reset baseline. Clearing judgments keeps historical analytics intact but excludes earlier videos, private metrics, and plans from subsequent account-stage decisions until new post-reset data arrives.
- The novel operation keeps organic views as the sole optimization target. AI may diagnose account stages and adjust post timing, while video-generation settings remain operator-controlled. Strategy generation remains reviewable, and task creation still depends on the existing automatic-task switch and safety limits.
- Reddit publishing offers two explicit providers. GeeLark remains the default and keeps its existing route; administrators can alternatively select the TikTok official API, read hosted authorized accounts, upload generated videos to the publishing hub, and create scheduled batch tasks. Once the hosted batch is accepted, Local Factory marks the task as `已提交发布中台` and stops tracking it. Signal Desk exclusively owns scheduling, TikTok submission, final-status polling, retries, video IDs, and failure handling.
- Local Factory now separates local publishing records by provider. The existing `发布记录` view shows only GeeLark/local publishing records, while administrators have a standalone `官方 API 发布记录` view for successful handoffs to Signal Desk. Official records retain account, file, planned time, local task ID and hosted batch IDs for later analytics matching, but deliberately do not duplicate Signal Desk final-status tracking.

## Project Coordination

- Official API result ingestion is a separate daily Local Factory job and does not change the legacy third-party analytics schedule. It runs at 08:30 Asia/Shanghai by default, queries only records whose planned publish date is before the current Beijing calendar date, groups requests by Signal Desk batch ID, and writes final status, TikTok video ID, actual publish time and stored video details back to the local publish record. Future-dated tasks are not queried early; missing details retry on later daily runs and unresolved records require review after seven days. Signal Desk bridge calls are serialized with a configurable 650 ms interval so larger account sets do not burst the bridge rate limit.
- Official TikTok long-term analytics history uses indexed SQLite at `D:/localcodex/work/official-tiktok-history/official-history.sqlite`. Account/day and video/day snapshots are stored as separate rows, while legacy daily JSON files are imported once and retained as backups.
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
- 每天的账号、视频和完整接口字段写入 `workDir/official-tiktok-history/YYYY-MM-DD.json`；当前 `workDir` 为 `D:/localcodex/work`，因此长期数据不占用 C 盘。
- 同一天手动重跑覆盖当天快照，不同日期永久保留，支持账号与单视频历史变化查询。
- 管理员侧边栏的官方数据入口现为 `授权账号`，并拆分为账号列表、账号详情与播放历史、所选账号视频、单视频历史变化四个页面；四个页面继续读取同一份本地 SQLite 归档并支持手动同步。
- 线上 Signal Desk 的官方日快照只保留 30 天；长期历史以本地 D 盘归档为准。
