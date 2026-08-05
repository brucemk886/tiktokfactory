# Current State

Updated: 2026-08-04

## Platform

- Local Factory serves its authenticated UI on port 3010 by default.
- Reddit, psychology, Schulte, analytics, GeeLark publishing, and operations-brain modules are present.
- Runtime output and queue data use configured work and output directories.
- TikTok AI Tool is maintained as a separate hosted subproject.
- Fivetran TikTok Organic owner authorization is available at `/tiktok-connections`; credentials and connection records stay in the configured runtime work directory.
- The Fivetran destination PostgreSQL reader is available on the same page. It discovers synchronized TikTok schemas and previews profile, video, retention, traffic-source, and audience metrics through read-only transactions.
- The admin-only `/tiktok-video-detail` page is available from the Local Factory sidebar. It filters synchronized accounts and TikTok video IDs, then shows one video's private metrics, interactive retention and like timelines, traffic sources, audience breakdowns, and comments for TikTok Studio accuracy checks.
- Operations Brain supports a full-data hybrid strategy route: DeepSeek V4 Flash processes every recent synchronized video and every available second-by-second retention/like point in bounded sequential batches, synthesizes the evidence, and SOL makes the final operating decision.
- Operations Brain reads up to 30 recent synchronized videos per selected account from the Fivetran destination, within the 10-day strategy window. The payload includes complete curves, completion/watch-time, reach, engagement, traffic-source, and audience-breakdown metrics. Destination failures remain non-blocking and publishing continues to use the existing safety controls.

## Project Coordination

- `AGENTS.md` defines shared working and handoff rules.
- Project Hub is the shared memory and multi-Agent coordination layer.
- Project Hub Agents run read-only audits and tests with a bounded concurrency limit.
- Existing rendering and publishing queues remain independent from Project Hub Agent runs.

## Safety

- Automated Agent runs cannot edit code or call external services.
- API keys and credentials must not be written to documentation or Git.
- Publishing actions remain behind existing task safety and GeeLark controls.
