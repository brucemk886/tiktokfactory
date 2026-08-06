# Current State

Updated: 2026-08-06

## Platform

- Local Factory serves its authenticated UI on port 3010 by default.
- Reddit, psychology, Schulte, analytics, GeeLark publishing, and operations-brain modules are present.
- Runtime output and queue data use configured work and output directories.
- TikTok AI Tool is maintained as a separate hosted subproject.
- Fivetran TikTok Organic owner authorization is available at `/tiktok-connections`; credentials and connection records stay in the configured runtime work directory.
- The Fivetran destination PostgreSQL reader is available on the same page. It discovers synchronized TikTok schemas and previews profile, video, retention, traffic-source, and audience metrics through read-only transactions.
- The admin-only `/tiktok-video-detail` page is available from the Local Factory sidebar. It filters synchronized accounts and TikTok video IDs, then shows one video's private metrics, interactive retention and like timelines, traffic sources, audience breakdowns, and comments for TikTok Studio accuracy checks.
- Novel AI Operations supports a full-data hybrid strategy route: DeepSeek V4 Flash processes every recent synchronized video and every available second-by-second retention/like point in bounded sequential batches, synthesizes the evidence, and SOL makes the final operating decision.
- Novel AI Operations reads up to 30 recent synchronized videos per selected account from the Fivetran destination, within the 10-day strategy window. The payload includes complete curves, completion/watch-time, reach, engagement, traffic-source, and audience-breakdown metrics. Destination failures remain non-blocking and publishing continues to use the existing safety controls.
- Novel AI Operations creates one standard Reddit automation workflow from one selected novel audio directory and one asset group or video directory. It uses the currently saved Reddit subtitle, deduplication, queue, retry, scheduling, publishing-copy, and GeeLark safety settings without generating alternate recipes or variants.
- Novel AI Operations has a configurable 1-30 day operating cycle, defaulting to 7 days. The cycle starts only after automation is enabled with at least one account group, shows its remaining days in the UI, and automatically disables both scheduled analysis and automatic task creation at expiry. Existing queued tasks are not cancelled. Re-enabling starts a fresh cycle.
- Novel AI Operations has an independent account-judgment reset baseline. Clearing judgments keeps historical analytics intact but excludes earlier videos, private metrics, and plans from subsequent account-stage decisions until new post-reset data arrives.
- The novel operation keeps organic views as the sole optimization target. AI may diagnose account stages and adjust post timing, while video-generation settings remain operator-controlled. Strategy generation remains reviewable, and task creation still depends on the existing automatic-task switch and safety limits.

## Project Coordination

- `AGENTS.md` defines shared working and handoff rules.
- Project Hub is the shared project registry and cross-chat handoff memory.
- Project Hub keeps project objectives, module boundaries, active state, and handoff records. It no longer creates or runs subproject Agents.
- Existing rendering, publishing, and operations queues remain independent from Project Hub records.

## Safety

- Project Hub is read-only context storage and does not execute code or call external services.
- API keys and credentials must not be written to documentation or Git.
- Publishing actions remain behind existing task safety and GeeLark controls.
